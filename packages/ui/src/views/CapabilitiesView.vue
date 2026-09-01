<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { ExternalLink, Play, Search, ShieldAlert } from '@lucide/vue';

import { type ApiCapability, type CapabilityDefinition } from '@one-vegetable/core';

import ActionTooltip from '../components/ActionTooltip.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Input from '../components/ui/Input.vue';
import Sheet from '../components/ui/Sheet.vue';
import { useUiI18n } from '../i18n';
import { capabilityMatrix, type CapabilityMatrixCell } from '../lib/capability-matrix';
import { resolveDataSource } from '../lib/data-source';
import { formatDate } from '../lib/date-time';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

const { gateway, mode, runtime } = useServices();
const { t } = useUiI18n();
const search = ref('');
const domain = ref('all');
const accountVerification = ref('all');
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
const dataSource = computed(() => resolveDataSource(mode, runtime));
const filtered = computed(() =>
  (capabilities.data.value ?? []).filter((item) => {
    const matchesSearch = item.method.toLowerCase().includes(search.value.toLowerCase());
    const matchesDomain = domain.value === 'all' || item.domain === domain.value;
    const matchesAccount =
      accountVerification.value === 'all' ||
      (item.accountVerificationStatus ?? 'not-tested') === accountVerification.value;
    return matchesSearch && matchesDomain && matchesAccount;
  })
);
const catalogCount = computed(
  () => (capabilities.data.value ?? []).filter((item) => item.source === 'catalog').length
);
const articleCount = computed(
  () => (capabilities.data.value ?? []).filter((item) => item.source === 'article').length
);
const accountPassedCount = computed(
  () =>
    (capabilities.data.value ?? []).filter((item) =>
      ['passed', 'no-data'].includes(item.accountVerificationStatus ?? 'not-tested')
    ).length
);
const accountDeniedCount = computed(
  () =>
    (capabilities.data.value ?? []).filter((item) => item.accountVerificationStatus === 'permission-denied')
      .length
);
const accountNotTestedCount = computed(
  () =>
    (capabilities.data.value ?? []).filter(
      (item) => (item.accountVerificationStatus ?? 'not-tested') === 'not-tested'
    ).length
);
const accountSnapshotDate = computed(
  () =>
    (capabilities.data.value ?? [])
      .find((item) => item.accountVerificationCheckedAt)
      ?.accountVerificationCheckedAt?.slice(0, 10) ?? null
);
const accountSnapshotNotice = computed(() => {
  if (mode === 'extension') {
    return t('capabilities.snapshotExtension');
  }
  return accountSnapshotDate.value
    ? t('capabilities.snapshotChecked', { date: accountSnapshotDate.value })
    : t('capabilities.snapshotMissing');
});
const selectedMatrix = computed(() =>
  selected.value ? capabilityMatrix(selected.value, dataSource.value) : null
);
const realCallBlocked = computed(() => mode === 'extension' && selected.value?.realCallEnabled === false);
const platformProtocolRestricted = computed(
  () => selected.value?.domain === 'platform' && selected.value.restricted
);
const platformNotice = computed(() => {
  if (selected.value?.method === 'alibaba.icbu.file.urlposting.upload') {
    return t('capabilities.notices.urlUpload');
  }
  if (selected.value?.method === 'alibaba.icbu.risk.send') {
    return t('capabilities.notices.riskSend');
  }
  if (selected.value?.method === 'alibaba.icbu.task.status.notify') {
    return t('capabilities.notices.taskNotify');
  }
  return '';
});
const callDisabledReason = computed(() => {
  if (!selected.value) return t('capabilities.disabled.select');
  if (selected.value.restricted) {
    return selected.value.restrictionReason ?? t('capabilities.disabled.restricted');
  }
  if (!selected.value.enabled) return t('capabilities.disabled.unavailable');
  if (realCallBlocked.value) return t('capabilities.disabled.extensionWrite');
  if (call.isPending.value) return t('capabilities.disabled.running');
  if (definitionError.value) {
    return t('capabilities.disabled.definitionFailed', { error: definitionError.value });
  }
  if (!definition.value || definitionMethod.value !== selected.value.method) {
    return t('capabilities.disabled.definitionLoading');
  }
  return '';
});

const call = useMutation({
  mutationFn: async () => {
    if (!selected.value) throw new Error(t('capabilities.errors.select'));
    if (definitionMethod.value !== selected.value.method) {
      throw new Error(t('capabilities.disabled.definitionLoading'));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(parameters.value) as unknown;
    } catch {
      validationErrors.value = [t('capabilities.errors.validJson')];
      throw new Error(t('capabilities.errors.invalidParameters'));
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      validationErrors.value = [t('capabilities.errors.jsonObject')];
      throw new Error(t('capabilities.errors.invalidParameters'));
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
    definitionError.value =
      error instanceof Error ? error.message : t('capabilities.errors.definitionFailed');
  }
}

const columns = computed<DataColumn<ApiCapability>[]>(() => [
  {
    accessorKey: 'method',
    header: t('capabilities.columns.method'),
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
    header: t('capabilities.columns.domain'),
    cell: (context) => h(Badge, { variant: 'secondary' }, () => context.getValue<string>())
  },
  {
    accessorKey: 'lifecycle',
    header: t('capabilities.columns.lifecycle'),
    cell: ({ row }) =>
      h(Badge, { variant: row.original.lifecycle === 'deprecated' ? 'warning' : 'success' }, () =>
        t(`capabilities.lifecycle.${row.original.lifecycle}`)
      )
  },
  {
    accessorKey: 'risk',
    header: t('capabilities.columns.risk'),
    cell: ({ row }) =>
      h(Badge, { variant: row.original.risk === 'mutation' ? 'warning' : 'outline' }, () =>
        t(`capabilities.risk.${row.original.risk}`)
      )
  },
  {
    id: 'contract',
    header: t('capabilities.columns.contract'),
    cell: ({ row }) => matrixBadge(capabilityMatrix(row.original, dataSource.value).contract)
  },
  {
    id: 'replay',
    header: t('capabilities.columns.replay'),
    cell: ({ row }) => matrixBadge(capabilityMatrix(row.original, dataSource.value).replay)
  },
  {
    id: 'account',
    header: t('capabilities.columns.account'),
    cell: ({ row }) => matrixBadge(capabilityMatrix(row.original, dataSource.value).account)
  },
  {
    id: 'current',
    header: t('capabilities.columns.current'),
    cell: ({ row }) => matrixBadge(capabilityMatrix(row.original, dataSource.value).current)
  },
  {
    id: 'docs',
    header: t('capabilities.columns.docs'),
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
]);

function matrixBadge(cell: CapabilityMatrixCell) {
  return h(Badge, { variant: cell.variant, title: cell.detail }, () => cell.label);
}
</script>

<template>
  <PageHeader :title="t('capabilities.title')" :description="t('capabilities.description')">
    <div class="flex gap-2">
      <Badge variant="success">{{ t('capabilities.catalogCount', { count: catalogCount }) }}</Badge
      ><Badge variant="outline">{{ t('capabilities.articleCount', { count: articleCount }) }}</Badge>
    </div>
  </PageHeader>
  <div class="mb-4 flex flex-wrap gap-2">
    <div class="relative min-w-72 flex-1">
      <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
      <Input
        v-model="search"
        class="pl-9"
        :aria-label="t('capabilities.search')"
        :placeholder="t('capabilities.search')"
      />
    </div>
    <select v-model="domain" class="h-9 rounded-md border bg-background px-3 text-sm">
      <option value="all">{{ t('capabilities.allDomains') }}</option>
      <option
        v-for="item in ['product', 'photo', 'trade', 'rfq', 'buyer', 'logistics', 'data', 'platform']"
        :key="item"
        :value="item"
      >
        {{ item }}
      </option>
    </select>
    <select
      v-model="accountVerification"
      :aria-label="t('capabilities.accountSnapshot')"
      class="h-9 rounded-md border bg-background px-3 text-sm"
    >
      <option value="all">{{ t('capabilities.allAccountResults') }}</option>
      <option value="passed">{{ t('capabilities.accountStatuses.passed') }}</option>
      <option value="no-data">{{ t('capabilities.accountStatuses.noData') }}</option>
      <option value="permission-denied">{{ t('capabilities.accountStatuses.permissionDenied') }}</option>
      <option value="contract-drift">{{ t('capabilities.accountStatuses.contractDrift') }}</option>
      <option value="provider-error">{{ t('capabilities.accountStatuses.providerError') }}</option>
      <option value="skipped-prerequisite">
        {{ t('capabilities.accountStatuses.skippedPrerequisite') }}
      </option>
      <option value="not-tested">{{ t('capabilities.accountStatuses.notTested') }}</option>
    </select>
  </div>
  <div class="mb-4 rounded-lg border bg-card p-3 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="success">{{
        t('capabilities.accountSummary.passed', { count: accountPassedCount })
      }}</Badge>
      <Badge variant="warning">{{
        t('capabilities.accountSummary.denied', { count: accountDeniedCount })
      }}</Badge>
      <Badge variant="outline">{{
        t('capabilities.accountSummary.notTested', { count: accountNotTestedCount })
      }}</Badge>
      <Badge variant="secondary">{{
        t('capabilities.accountSummary.current', { source: dataSource.label })
      }}</Badge>
    </div>
    <p class="mt-2 text-xs text-muted-foreground">
      {{ t('capabilities.runtimeNotice', { snapshot: accountSnapshotNotice }) }}
    </p>
  </div>
  <QueryState
    :loading="capabilities.isPending.value"
    :error="capabilities.error.value"
    retryable
    @retry="capabilities.refetch()"
  >
    <DataTable
      :columns="columns"
      :data="filtered"
      :empty-text="t('capabilities.noMatch')"
      min-width="1520px"
      :get-row-key="(capability) => capability.method"
      :active-row-key="capabilitySheetOpen ? selected?.method : undefined"
      :row-aria-label="(capability) => t('capabilities.viewApi', { method: capability.method })"
      @row-activate="selectCapability"
    >
      <template #empty>
        <div class="space-y-3 py-4">
          <p>{{ t('capabilities.noMatch') }}</p>
          <Button
            variant="outline"
            size="sm"
            @click="
              search = '';
              domain = 'all';
              accountVerification = 'all';
            "
            >{{ t('capabilities.clearFilters') }}</Button
          >
        </div>
      </template>
    </DataTable>
  </QueryState>

  <Sheet
    :open="capabilitySheetOpen"
    :title="selected?.method ?? t('capabilities.detailsTitle')"
    :description="t('capabilities.detailsDescription')"
    @update:open="capabilitySheetOpen = $event"
  >
    <div v-if="selected">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="font-mono text-sm font-semibold">{{ selected.method }}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {{
              t('capabilities.checkedAndUpdated', {
                checked: formatDate(selected.checkedAt, selected.checkedAt),
                updated: formatDate(selected.updatedAt, selected.updatedAt ?? t('capabilities.unknown'))
              })
            }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Badge variant="outline">{{ selected.source }}</Badge>
          <Badge variant="outline">{{
            t('capabilities.documentVerification', { verification: selected.verification })
          }}</Badge>
          <Badge :variant="selected.risk === 'mutation' ? 'warning' : 'success'">{{
            t(`capabilities.risk.${selected.risk}`)
          }}</Badge>
        </div>
      </div>

      <div v-if="selectedMatrix" class="mt-4 grid gap-2 sm:grid-cols-2">
        <div
          v-for="item in [
            { name: t('capabilities.matrixNames.contract'), cell: selectedMatrix.contract },
            { name: t('capabilities.matrixNames.replay'), cell: selectedMatrix.replay },
            { name: t('capabilities.matrixNames.account'), cell: selectedMatrix.account },
            { name: t('capabilities.matrixNames.current'), cell: selectedMatrix.current }
          ]"
          :key="item.name"
          class="rounded-lg border bg-muted/30 p-3"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-muted-foreground">{{ item.name }}</span>
            <Badge :variant="item.cell.variant">{{ item.cell.label }}</Badge>
          </div>
          <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ item.cell.detail }}</p>
        </div>
      </div>

      <div
        v-if="selected.lifecycle === 'deprecated'"
        class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
      >
        {{ t('capabilities.deprecatedNotice') }}
      </div>
      <div v-if="realCallBlocked" class="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        <ShieldAlert class="mt-0.5 size-4 shrink-0" />{{ t('capabilities.realWriteBlocked') }}
      </div>
      <div
        v-if="selected.restricted"
        class="mt-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
      >
        <ShieldAlert class="mt-0.5 size-4 shrink-0" />{{
          selected.restrictionReason ?? t('capabilities.restrictedFallback')
        }}
      </div>
      <div v-if="platformNotice" class="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
        {{ platformNotice }}
      </div>
      <p v-if="definitionError" class="mt-3 text-sm text-destructive">{{ definitionError }}</p>
      <p v-if="definition" class="mt-4 text-sm text-muted-foreground">{{ definition.description }}</p>
      <div v-if="definition" class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <code class="rounded bg-muted p-2">{{
          t('capabilities.requestSchema', { schema: definition.requestSchema })
        }}</code>
        <code class="rounded bg-muted p-2">{{
          t('capabilities.responseSchema', { schema: definition.responseSchema })
        }}</code>
      </div>
      <pre
        v-if="platformProtocolRestricted"
        :aria-label="t('capabilities.readonlyExample')"
        class="mt-4 max-h-64 overflow-auto rounded-md border bg-slate-950 p-3 font-mono text-xs text-slate-100"
        >{{ parameters }}</pre>
      <textarea
        v-else
        v-model="parameters"
        :aria-label="t('capabilities.parameters')"
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
        <p class="font-medium">{{ t('capabilities.driftTitle', { traceId: call.data.value.traceId }) }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="issue in call.data.value.contractIssues" :key="`${issue.instancePath}:${issue.keyword}`">
            {{ issue.instancePath }} {{ issue.message }}
          </li>
        </ul>
        <p class="mt-2 text-xs">{{ t('capabilities.driftRaw') }}</p>
      </div>
      <pre v-if="call.data.value" class="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{{
        JSON.stringify(call.data.value, null, 2)
      }}</pre>
      <ErrorNotice v-if="call.error.value" class="mt-3" :error="call.error.value" compact />
      <ActionTooltip :disabled="Boolean(callDisabledReason)" :reason="callDisabledReason">
        <Button class="mt-3" :disabled="Boolean(callDisabledReason)" @click="call.mutate()">
          <Play class="size-4" />{{ t('capabilities.call') }}
        </Button>
      </ActionTooltip>
    </div>
  </Sheet>
</template>
