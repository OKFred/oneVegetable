<script setup lang="ts">
import { computed, h, nextTick, onMounted, onScopeDispose, ref } from 'vue';
import { Search, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import type { ControlAuditEvent, ControlRequestEvent } from '@one-vegetable/core';
import AuditListFilters from './AuditListFilters.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import DataTable from './DataTable.vue';
import ErrorNotice from './ErrorNotice.vue';
import ListActionButton from './ListActionButton.vue';
import ListToolbar from './ListToolbar.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import { auditFilterPayload, emptyAuditFilters, type AuditFilters } from '../lib/audit-filters';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';
import { useUiI18n } from '../i18n';
import type { DataColumn } from '../lib/table';

const props = defineProps<{ kind: 'requests' | 'audit' }>();
const appliedRequestId = defineModel<string>('requestId', { default: '' });
const { control } = useServices();
const { t } = useUiI18n();
const requestIdDraft = ref(appliedRequestId.value);
const filters = ref(emptyAuditFilters());
const page = ref(1),
  pageSize = ref(20),
  total = ref(0);
const requests = ref<ControlRequestEvent[]>([]);
const audits = ref<ControlAuditEvent[]>([]);
const loading = ref(false),
  purging = ref(false),
  confirmPurge = ref(false);
const error = ref<unknown>(null),
  notice = ref('');
const retentionDays = ref<number | null>(null);
let active = true;
const isActive = () => active;
onScopeDispose(() => {
  active = false;
});
const key = computed(() => (props.kind === 'requests' ? 'admin.view.requests' : 'admin.view.audit'));
const selectionScope = computed(() => JSON.stringify([appliedRequestId.value, filters.value]));
const blocked = computed(() => loading.value || purging.value);

onMounted(async () => {
  await Promise.all([
    load(),
    props.kind === 'requests' && control
      ? control
          .system()
          .then((system) => {
            if (active) retentionDays.value = system.requestEventRetentionDays;
          })
          .catch(() => {
            /* The list remains usable if system metadata is unavailable. */
          })
      : Promise.resolve()
  ]);
});

async function load(): Promise<void> {
  if (!control || loading.value || !isActive()) return;
  loading.value = true;
  error.value = null;
  try {
    const input = {
      ...auditFilterPayload(filters.value),
      page: page.value,
      pageSize: pageSize.value,
      ...(appliedRequestId.value ? { requestIdFilter: appliedRequestId.value } : {})
    };
    const operation = filters.value.operation.trim();
    if (props.kind === 'requests') {
      const result = await control.listRequestEvents({ ...input, ...(operation ? { operation } : {}) });
      if (!isActive()) return;
      requests.value = result.items;
      total.value = result.total;
    } else {
      const result = await control.listAudit({ ...input, ...(operation ? { action: operation } : {}) });
      if (!isActive()) return;
      audits.value = result.items;
      total.value = result.total;
    }
  } catch (cause: unknown) {
    if (!isActive()) return;
    requests.value = [];
    audits.value = [];
    total.value = 0;
    error.value =
      cause instanceof Error
        ? cause
        : new Error(
            t(props.kind === 'requests' ? 'admin.view.errors.requestsLoad' : 'admin.view.errors.auditLoad')
          );
  } finally {
    if (isActive()) loading.value = false;
  }
}
async function search(): Promise<void> {
  if (blocked.value) return;
  appliedRequestId.value = requestIdDraft.value.trim();
  page.value = 1;
  await nextTick();
  await load();
}
async function applyFilters(value: AuditFilters): Promise<void> {
  if (blocked.value) return;
  filters.value = value;
  page.value = 1;
  await load();
}
async function setPage(value: number): Promise<void> {
  if (blocked.value) return;
  page.value = value;
  await load();
}
async function setPageSize(value: number): Promise<void> {
  if (blocked.value) return;
  page.value = 1;
  pageSize.value = value;
  await load();
}
async function purge(): Promise<void> {
  if (!control || blocked.value) return;
  confirmPurge.value = false;
  purging.value = true;
  error.value = null;
  try {
    const result = await control.purgeRequestEvents();
    if (!active) return;
    retentionDays.value = result.retentionDays;
    notice.value = t('admin.view.feedback.purgedNotice', {
      count: result.deletedCount,
      days: result.retentionDays
    });
    toast.success(t('admin.view.feedback.purgedToast', { count: result.deletedCount }));
    page.value = 1;
    await load();
  } catch (cause: unknown) {
    if (active) error.value = cause instanceof Error ? cause : new Error(t('admin.view.errors.purge'));
  } finally {
    if (active) purging.value = false;
  }
}

const requestEventColumns = computed<DataColumn<ControlRequestEvent>[]>(() => [
  {
    accessorKey: 'eventTimeUtc',
    header: t('admin.view.columns.time'),
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, formatDateTime(row.original.eventTimeUtc))
  },
  {
    accessorKey: 'requestId',
    header: 'requestId',
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.requestId)
  },
  {
    accessorKey: 'actorId',
    header: t('admin.view.columns.actor'),
    cell: ({ row }) => row.original.actorId ?? 'anonymous'
  },
  {
    id: 'runtimeRoute',
    header: t('admin.view.columns.runtimeRoute'),
    cell: ({ row }) => `${row.original.runtime} / ${row.original.route}`
  },
  { accessorKey: 'operation', header: 'Operation' },
  { accessorKey: 'outcome', header: t('admin.view.columns.result') },
  {
    id: 'statusDuration',
    header: t('admin.view.columns.statusDuration'),
    cell: ({ row }) => `${row.original.statusCode} / ${row.original.durationMilliseconds} ms`
  }
]);

const auditEventColumns = computed<DataColumn<ControlAuditEvent>[]>(() => [
  {
    accessorKey: 'eventTimeUtc',
    header: t('admin.view.columns.time'),
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, formatDateTime(row.original.eventTimeUtc))
  },
  {
    accessorKey: 'requestId',
    header: 'requestId',
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.requestId)
  },
  {
    accessorKey: 'actorId',
    header: t('admin.view.columns.actor'),
    cell: ({ row }) => row.original.actorId ?? 'anonymous'
  },
  { accessorKey: 'action', header: t('admin.view.columns.action') },
  { accessorKey: 'outcome', header: t('admin.view.columns.result') },
  { accessorKey: 'reasonCode', header: t('admin.view.columns.reason') }
]);
</script>
<template>
  <section class="min-w-0 space-y-3" :aria-label="t(key + '.title')">
    <div>
      <h2 class="font-semibold">{{ t(key + '.title') }}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{{ t(key + '.description') }}</p>
      <p v-if="retentionDays !== null" class="mt-1 text-xs text-muted-foreground">
        {{ t('admin.view.system.retention', { days: retentionDays }) }}
      </p>
    </div>
    <p v-if="notice" role="status" class="rounded-lg border bg-muted p-3 text-sm">{{ notice }}</p>
    <ErrorNotice v-if="error" :error="error" compact />
    <Card class="min-w-0 overflow-hidden">
      <ListToolbar @search="search">
        <template #search>
          <Input
            v-model="requestIdDraft"
            class="min-w-0 flex-1"
            :aria-label="t('admin.view.requests.filterAria')"
            placeholder="requestId (UUID v4)"
          />
          <ListActionButton :icon="Search" type="submit" :disabled="blocked" :aria-busy="loading">{{
            t('admin.view.requests.query')
          }}</ListActionButton>
        </template>
        <template #actions>
          <AuditListFilters :kind="kind" :model-value="filters" @update:model-value="applyFilters" />
          <ListActionButton
            v-if="kind === 'requests'"
            data-testid="purge-request-events"
            :icon="Trash2"
            :disabled="blocked"
            @click="confirmPurge = true"
            >{{ t('admin.view.requests.purge') }}</ListActionButton
          >
        </template>
      </ListToolbar>
      <div v-if="kind === 'requests'" data-testid="request-events">
        <DataTable
          column-settings-key="admin-diagnostics"
          :columns="requestEventColumns"
          :data="requests"
          :page="page"
          :page-size="pageSize"
          :total-rows="total"
          :pagination-disabled="blocked"
          :selection-scope="selectionScope"
          max-height="min(60vh, 36rem)"
          min-width="980px"
          :empty-text="t('admin.view.requests.empty')"
          @update:page="setPage"
          @update:page-size="setPageSize"
        />
      </div>
      <div v-else data-testid="audit-events">
        <DataTable
          column-settings-key="admin-audit"
          :columns="auditEventColumns"
          :data="audits"
          :page="page"
          :page-size="pageSize"
          :total-rows="total"
          :pagination-disabled="blocked"
          :selection-scope="selectionScope"
          max-height="min(60vh, 36rem)"
          min-width="900px"
          :empty-text="t('admin.view.audit.empty')"
          @update:page="setPage"
          @update:page-size="setPageSize"
        />
      </div>
    </Card>
    <ConfirmActionDialog
      :open="confirmPurge"
      :title="t('admin.view.confirmation.purgeTitle')"
      :description="
        t('admin.view.confirmation.purgeDescription', {
          days: retentionDays ?? t('admin.view.confirmation.configured')
        })
      "
      destructive
      :confirm-label="t('admin.view.confirmation.confirm')"
      @update:open="confirmPurge = $event"
      @confirm="purge"
    >
      <p>{{ t('admin.view.confirmation.auditNotice') }}</p>
    </ConfirmActionDialog>
  </section>
</template>
