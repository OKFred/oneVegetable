<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { ExternalLink, Play, Search } from '@lucide/vue';

import { validateCapabilityCallInput, type ApiCapability } from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

const { gateway } = useServices();
const search = ref('');
const domain = ref('all');
const selected = ref<ApiCapability | null>(null);
const parameters = ref('{}');
const validationErrors = ref<string[]>([]);
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
const call = useMutation({
  mutationFn: async () => {
    if (!selected.value) throw new Error('请选择 API');
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
    const validation = validateCapabilityCallInput(payload);
    validationErrors.value = validation.errors;
    if (!validation.valid) throw new Error('参数校验失败');
    return gateway.request('callCapability', payload);
  }
});

const columns: DataColumn<ApiCapability>[] = [
  {
    accessorKey: 'method',
    header: 'API 方法',
    cell: ({ row }) =>
      h(
        'button',
        {
          class: 'font-mono text-xs text-primary hover:underline',
          onClick: () => (selected.value = row.original)
        },
        row.original.method
      )
  },
  {
    accessorKey: 'domain',
    header: '业务域',
    cell: (context) => h(Badge, { variant: 'secondary' }, () => context.getValue<string>())
  },
  { accessorKey: 'auth', header: '授权' },
  {
    accessorKey: 'chargeLabel',
    header: '收费标签',
    cell: (context) => h(Badge, { variant: 'success' }, () => context.getValue<string>())
  },
  {
    id: 'state',
    header: '状态',
    cell: ({ row }) =>
      h(
        Badge,
        { variant: row.original.restricted ? 'warning' : row.original.enabled ? 'success' : 'outline' },
        () => (row.original.restricted ? '受限' : row.original.enabled ? '已启用' : '待接入')
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
    description="免费且非聚石塔接口的审计快照。受限接口保留可见性，但默认不能调用。"
  />
  <div class="mb-4 flex flex-wrap gap-2">
    <div class="relative min-w-72 flex-1">
      <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input
        v-model="search"
        class="pl-9"
        placeholder="搜索 API 方法"
      />
    </div>
    <select v-model="domain" class="h-9 rounded-md border bg-background px-3 text-sm">
      <option value="all">全部业务域</option>
      <option
        v-for="item in ['product', 'photo', 'trade', 'rfq', 'buyer', 'logistics', 'data', 'other']"
        :key="item"
        :value="item"
      >
        {{ item }}
      </option>
    </select>
  </div>
  <QueryState :loading="capabilities.isPending.value" :error="capabilities.error.value">
    <DataTable :columns="columns" :data="filtered" empty-text="没有匹配的 API" />
  </QueryState>
  <Card v-if="selected" class="mt-5 p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="font-mono text-sm font-semibold">{{ selected.method }}</p>
        <p class="mt-1 text-xs text-muted-foreground">检查日期 {{ selected.checkedAt }}</p>
      </div>
      <Badge :variant="selected.restricted ? 'warning' : selected.enabled ? 'success' : 'outline'">{{
        selected.restricted ? selected.restrictionReason : selected.enabled ? '可调试' : '下一迭代接入'
      }}</Badge>
    </div>
    <textarea
      v-model="parameters"
      class="mt-4 min-h-28 w-full rounded-md border bg-slate-950 p-3 font-mono text-xs text-slate-100 outline-none focus:ring-2 focus:ring-ring"
      spellcheck="false"
    />
    <ul v-if="validationErrors.length" class="mt-2 text-sm text-destructive">
      <li v-for="error in validationErrors" :key="error">{{ error }}</li>
    </ul>
    <pre v-if="call.data.value" class="mt-3 overflow-auto rounded-md bg-muted p-3 text-xs">{{
      JSON.stringify(call.data.value, null, 2)
    }}</pre>
    <p v-if="call.error.value" class="mt-2 text-sm text-destructive">{{ call.error.value.message }}</p>
    <Button
      class="mt-3"
      :disabled="selected.restricted || !selected.enabled || call.isPending.value"
      @click="call.mutate()"
      ><Play class="size-4" />调用能力</Button
    >
  </Card>
</template>
