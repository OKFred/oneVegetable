<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { ExternalLink, Play, Search, ShieldAlert } from '@lucide/vue';

import { type ApiCapability, type CapabilityDefinition } from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Input from '../components/ui/Input.vue';
import Sheet from '../components/ui/Sheet.vue';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

const { gateway, mode } = useServices();
const search = ref('');
const domain = ref('all');
const selected = ref<ApiCapability | null>(null);
const capabilitySheetOpen = ref(false);
const definition = ref<CapabilityDefinition | null>(null);
const definitionMethod = ref('');
const definitionError = ref('');
const parameters = ref('{}');
const validationErrors = ref<string[]>([]);
let selectionSequence = 0;
const capabilities = useQuery({
  queryKey: ['capabilities'],
  queryFn: () => gateway.request('listCapabilities', undefined)
});
const filtered = computed(() =>
  (capabilities.data.value ?? []).filter((item) => {
    const matchesSearch = item.method.toLowerCase().includes(search.value.toLowerCase());
    return matchesSearch && (domain.value === 'all' || item.domain === domain.value);
  })
);
const catalogCount = computed(
  () => (capabilities.data.value ?? []).filter((item) => item.source === 'catalog').length
);
const articleCount = computed(
  () => (capabilities.data.value ?? []).filter((item) => item.source === 'article').length
);
const realCallBlocked = computed(() => mode === 'extension' && selected.value?.realCallEnabled === false);
const platformProtocolRestricted = computed(
  () => selected.value?.domain === 'platform' && selected.value.restricted
);
const platformNotice = computed(() => {
  if (selected.value?.method === 'alibaba.icbu.file.urlposting.upload') {
    return '该接口只返回普通文件 URL，不返回图库 fileId，因此不会用于商品主图、SKU 图或详情图入库。';
  }
  if (selected.value?.method === 'alibaba.icbu.risk.send') {
    return '这是天鹿风控协议能力。本项目不采集 WUA、UMID、IMEI、IMSI、MAC 等设备环境信息，也不提供发送入口。';
  }
  if (selected.value?.method === 'alibaba.icbu.task.status.notify') {
    return '这是 URL 爬取供应商的状态回调，不是卖家操作。没有平台下发的真实任务上下文时禁止调用。';
  }
  return '';
});

const call = useMutation({
  mutationFn: async () => {
    if (!selected.value) throw new Error('请选择 API');
    if (definitionMethod.value !== selected.value.method) throw new Error('能力定义仍在加载');
    let parsed: unknown;
    try {
      parsed = JSON.parse(parameters.value) as unknown;
    } catch {
      validationErrors.value = ['参数必须是合法 JSON'];
      throw new Error('参数格式错误');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      validationErrors.value = ['参数必须是 JSON 对象'];
      throw new Error('参数格式错误');
    }
    const payload = { method: selected.value.method, parameters: parsed as Record<string, unknown> };
    validationErrors.value = [];
    return gateway.request('callCapability', payload);
  }
});

async function selectCapability(capability: ApiCapability): Promise<void> {
  const sequence = ++selectionSequence;
  selected.value = capability;
  capabilitySheetOpen.value = true;
  definition.value = null;
  definitionMethod.value = '';
  definitionError.value = '';
  call.reset();
  try {
    const result = await gateway.request('getCapabilityDefinition', { method: capability.method });
    if (sequence !== selectionSequence) return;
    definition.value = result;
    definitionMethod.value = capability.method;
    parameters.value = JSON.stringify(result.requestExample, null, 2);
  } catch (error: unknown) {
    if (sequence !== selectionSequence) return;
    parameters.value = '{}';
    definitionError.value = error instanceof Error ? error.message : '能力定义加载失败';
  }
}

const columns: DataColumn<ApiCapability>[] = [
  {
    accessorKey: 'method',
    header: 'API 方法',
    cell: ({ row }) =>
      h(
        'button',
        {
          class: 'font-mono text-xs text-primary hover:underline',
          onClick: () => void selectCapability(row.original)
        },
        row.original.method
      )
  },
  {
    accessorKey: 'domain',
    header: '业务域',
    cell: (context) => h(Badge, { variant: 'secondary' }, () => context.getValue<string>())
  },
  {
    accessorKey: 'lifecycle',
    header: '生命周期',
    cell: ({ row }) =>
      h(Badge, { variant: row.original.lifecycle === 'deprecated' ? 'warning' : 'success' }, () =>
        row.original.lifecycle === 'deprecated' ? 'deprecated' : row.original.lifecycle
      )
  },
  {
    accessorKey: 'risk',
    header: '风险',
    cell: ({ row }) =>
      h(Badge, { variant: row.original.risk === 'mutation' ? 'warning' : 'outline' }, () =>
        row.original.risk === 'mutation' ? '写操作' : '只读'
      )
  },
  {
    id: 'state',
    header: '状态',
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.restricted ? 'warning' : row.original.enabled ? 'success' : 'outline' },
        () => (row.original.restricted ? '受限' : row.original.enabled ? '已类型化' : '待接入')
      )
  },
  {
    id: 'docs',
    header: '文档',
    cell: ({ row }) =>
      h(
        'a',
        {
          href: row.original.docUrl,
          target: '_blank',
          rel: 'noreferrer',
          class: 'inline-flex text-muted-foreground hover:text-primary'
        },
        [h(ExternalLink, { class: 'size-4' })]
      )
  }
];
</script>

<template>
  <PageHeader
    title="API 能力目录"
    description="免费目录按审计快照统计；Schema 发品文章接口单列，不计入免费 API 数量。"
  >
    <div class="flex gap-2">
      <Badge variant="success">目录 {{ catalogCount }}</Badge
      ><Badge variant="outline">文章 {{ articleCount }}</Badge>
    </div>
  </PageHeader>
  <div class="mb-4 flex flex-wrap gap-2">
    <div class="relative min-w-72 flex-1">
      <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
      <Input v-model="search" class="pl-9" aria-label="搜索 API 方法" placeholder="搜索 API 方法" />
    </div>
    <select v-model="domain" class="h-9 rounded-md border bg-background px-3 text-sm">
      <option value="all">全部业务域</option>
      <option
        v-for="item in ['product', 'photo', 'trade', 'rfq', 'buyer', 'logistics', 'data', 'platform']"
        :key="item"
        :value="item"
      >
        {{ item }}
      </option>
    </select>
  </div>
  <QueryState :loading="capabilities.isPending.value" :error="capabilities.error.value">
    <DataTable
      :columns="columns"
      :data="filtered"
      empty-text="没有匹配的 API"
      min-width="1080px"
      :get-row-key="(capability) => capability.method"
      :active-row-key="capabilitySheetOpen ? selected?.method : undefined"
      :row-aria-label="(capability) => `查看 API ${capability.method}`"
      @row-activate="selectCapability"
    />
  </QueryState>

  <Sheet
    :open="capabilitySheetOpen"
    :title="selected?.method ?? 'API 能力详情'"
    description="能力定义、调用参数与响应结果"
    @update:open="capabilitySheetOpen = $event"
  >
    <div v-if="selected">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="font-mono text-sm font-semibold">{{ selected.method }}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            检查日期 {{ selected.checkedAt }} · 文档更新 {{ selected.updatedAt ?? '未知' }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Badge variant="outline">{{ selected.source }}</Badge>
          <Badge variant="outline">{{ selected.verification }}</Badge>
          <Badge :variant="selected.risk === 'mutation' ? 'warning' : 'success'">{{ selected.risk }}</Badge>
        </div>
      </div>

      <div
        v-if="selected.lifecycle === 'deprecated'"
        class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
      >
        该接口已 deprecated，仅在通用调试器保留类型化兼容；商品专用页面不会调用它。
      </div>
      <div v-if="realCallBlocked" class="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        <ShieldAlert
          class="mt-0.5 size-4 shrink-0"
        />该真实写能力未在当前扩展版本开放，后台会在出网前拒绝调用。
      </div>
      <div
        v-if="selected.restricted"
        class="mt-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
      >
        <ShieldAlert class="mt-0.5 size-4 shrink-0" />{{
          selected.restrictionReason ?? '该能力需要专用业务上下文。'
        }}
      </div>
      <div v-if="platformNotice" class="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
        {{ platformNotice }}
      </div>
      <p v-if="definitionError" class="mt-3 text-sm text-destructive">{{ definitionError }}</p>
      <p v-if="definition" class="mt-4 text-sm text-muted-foreground">{{ definition.description }}</p>
      <div v-if="definition" class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <code class="rounded bg-muted p-2">request: {{ definition.requestSchema }}</code>
        <code class="rounded bg-muted p-2">response: {{ definition.responseSchema }}</code>
      </div>
      <pre
        v-if="platformProtocolRestricted"
        aria-label="只读文档参数示例"
        class="mt-4 max-h-64 overflow-auto rounded-md border bg-slate-950 p-3 font-mono text-xs text-slate-100"
        >{{ parameters }}</pre>
      <textarea
        v-else
        v-model="parameters"
        aria-label="调用参数 JSON"
        class="mt-4 min-h-40 w-full rounded-md border bg-slate-950 p-3 font-mono text-xs text-slate-100 outline-none focus:ring-2 focus:ring-ring"
        spellcheck="false"
      />
      <ul v-if="validationErrors.length" class="mt-2 text-sm text-destructive">
        <li v-for="error in validationErrors" :key="error">{{ error }}</li>
      </ul>

      <div
        v-if="call.data.value && !call.data.value.contractValid"
        class="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
      >
        <p class="font-medium">响应契约漂移 · traceId {{ call.data.value.traceId }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="issue in call.data.value.contractIssues" :key="`${issue.instancePath}:${issue.keyword}`">
            {{ issue.instancePath }} {{ issue.message }}
          </li>
        </ul>
        <p class="mt-2 text-xs">原始响应仍保留在下方，便于结合 traceId 排查。</p>
      </div>
      <pre v-if="call.data.value" class="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{{
        JSON.stringify(call.data.value, null, 2)
      }}</pre>
      <p v-if="call.error.value" class="mt-2 text-sm text-destructive">{{ call.error.value.message }}</p>
      <Button
        class="mt-3"
        :disabled="
          selected.restricted ||
          !selected.enabled ||
          realCallBlocked ||
          call.isPending.value ||
          !definition ||
          definitionMethod !== selected.method
        "
        @click="call.mutate()"
        ><Play class="size-4" />调用能力</Button
      >
    </div>
  </Sheet>
</template>
