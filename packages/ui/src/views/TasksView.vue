<script setup lang="ts">
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Search, Settings, ArrowUpRight, Copy } from '@lucide/vue';
import { toast } from 'vue-sonner';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import { useServices } from '../lib/services';
import { useGalleryTransfers } from '../lib/gallery-transfer-service';
import { IndexedDbGalleryTaskRepository } from '../lib/gallery-task-repository';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { VAULT_UNLOCKED_EVENT } from '../lib/unsaved-editing';
import { useAppPreferences } from '../lib/preferences';
import { appHash } from '../lib/hash-router';
import { formatDateTime } from '../lib/date-time';
import {
  loadTaskCenterSnapshot,
  bindTaskBatchItems,
  taskContextStamp,
  type TaskSource,
  type TaskSummary,
  type TaskState
} from '../lib/task-center';
import type { DataColumn } from '../lib/table';
import { useTaskI18n } from '../i18n/tasks';
import { hasUiTranslation, useUiI18n } from '../i18n';
import DataTable from '../components/DataTable.vue';
import ListToolbar from '../components/ListToolbar.vue';
import ListFilterDialog from '../components/ListFilterDialog.vue';
import ListActionButton from '../components/ListActionButton.vue';
import Sheet from '../components/ui/Sheet.vue';
import Button from '../components/ui/Button.vue';
import Input from '../components/ui/Input.vue';
import Badge from '../components/ui/Badge.vue';

const ProductVideoAssociation = defineAsyncComponent(
  () => import('../components/ProductVideoAssociation.vue')
);
const services = useServices();
const transfers = useGalleryTransfers();
const repository = transfers?.repository ?? new IndexedDbGalleryTaskRepository();
const identityScope = useListIdentityScope();
const { alibabaLanguage } = useAppPreferences();
const tt = useTaskI18n();
const { t } = useUiI18n();
const items = shallowRef<TaskSummary[]>([]);
const context = shallowRef<GalleryTransferContext | null>(null);
const errors = ref<{ source: TaskSource; code: string }[]>([]);
const unscopedQueueCount = ref(0),
  productHasMore = ref(false),
  busy = ref(false),
  failed = ref(false);
const selectedId = ref(''),
  associationOpen = ref(false),
  associationBusy = ref(false);
const searchText = ref(''),
  search = ref(''),
  page = ref(1),
  pageSize = ref(20);
const selected = computed(() => items.value.find((item) => item.id === selectedId.value) ?? null);
const sources: TaskSource[] = ['product', 'gallery', 'video-upload', 'video-association'];
const states: TaskState[] = [
  'pending',
  'running',
  'submitted',
  'confirmed',
  'attention',
  'failed',
  'cancelled'
];
interface Filters {
  source: string;
  status: string;
  from: string;
  to: string;
  attentionFirst: boolean;
}
const defaults = (): Filters => ({ source: '', status: '', from: '', to: '', attentionFirst: true });
const filters = ref(defaults()),
  draft = ref(defaults()),
  filterOpen = ref(false);
const invalidRange = computed(
  () => !!draft.value.from && !!draft.value.to && draft.value.from > draft.value.to
);
const filterCount = computed(
  () =>
    Number(!!filters.value.source) +
    Number(!!filters.value.status) +
    Number(!!filters.value.from || !!filters.value.to)
);
const needsAttention = (item: TaskSummary) =>
  item.contextChanged || item.status === 'attention' || item.status === 'failed';
const attentionCount = computed(() => items.value.filter(needsAttention).length);
const filtered = computed(() => {
  const f = filters.value,
    query = search.value.trim().toLocaleLowerCase();
  const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : -Infinity;
  const to = f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : Infinity;
  return items.value
    .filter(
      (item) =>
        (!f.source || item.source === f.source) &&
        (!f.status || item.status === f.status) &&
        item.updatedAt >= from &&
        item.updatedAt <= to &&
        (!query ||
          [item.title, item.sourceId, item.resourceId, item.requestId].some((value) =>
            value?.toLocaleLowerCase().includes(query)
          ))
    )
    .toSorted(
      (a, b) =>
        (f.attentionFirst ? Number(needsAttention(b)) - Number(needsAttention(a)) : 0) ||
        b.updatedAt - a.updatedAt ||
        a.id.localeCompare(b.id)
    );
});
watch(filterOpen, (open) => {
  if (open) draft.value = { ...filters.value };
});
function applyFilters() {
  if (invalidRange.value) return;
  filters.value = { ...draft.value };
  filterOpen.value = false;
  page.value = 1;
}
let epoch = 0,
  productPage = 1,
  alive = true,
  mounted = false;
function isCurrent(ticket: number, scope: string) {
  return alive && ticket === epoch && scope === identityScope.value;
}
function clear() {
  epoch += 1;
  items.value = [];
  errors.value = [];
  context.value = null;
  selectedId.value = '';
  associationOpen.value = false;
  busy.value = false;
  productHasMore.value = false;
  unscopedQueueCount.value = 0;
  productPage = 1;
  page.value = 1;
}
async function load(more = false) {
  if (busy.value || !alive) return;
  const ticket = ++epoch,
    scope = identityScope.value;
  const previous = items.value,
    stamp = context.value ? taskContextStamp(context.value) : null;
  const nextPage = more ? productPage + 1 : 1;
  busy.value = true;
  failed.value = false;
  try {
    const result = await loadTaskCenterSnapshot(
      services,
      repository,
      globalThis.localStorage,
      () => isCurrent(ticket, scope),
      nextPage
    );
    if (!isCurrent(ticket, scope)) return;
    if (more && stamp !== taskContextStamp(result.context)) throw new Error('TASK_CONTEXT_CHANGED');
    const retained = more ? previous.filter((item) => item.source === 'product') : [];
    items.value = [...new Map([...retained, ...result.items].map((item) => [item.id, item])).values()];
    errors.value = result.errors;
    context.value = result.context;
    productHasMore.value = result.productHasMore;
    // The old queue has no owner. Never display its contents as current-account data.
    unscopedQueueCount.value = result.unscopedQueueCount;
    if (more) {
      const queue = bindTaskBatchItems(globalThis.localStorage, items.value);
      items.value = queue.items;
      unscopedQueueCount.value = queue.unscopedQueueCount;
    }
    if (!result.errors.some((error) => error.source === 'product')) productPage = nextPage;
  } catch {
    if (isCurrent(ticket, scope)) {
      clear();
      failed.value = true;
    }
  } finally {
    if (ticket === epoch) busy.value = false;
  }
}
function searchTasks() {
  search.value = searchText.value;
  page.value = 1;
  void load();
}
function invalidate() {
  clear();
  if (mounted && alive) void load();
}
watch(identityScope, invalidate);
onMounted(() => {
  mounted = true;
  globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, invalidate);
  globalThis.addEventListener(VAULT_UNLOCKED_EVENT, invalidate);
  void load();
});
onBeforeUnmount(() => {
  alive = false;
  clear();
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, invalidate);
  globalThis.removeEventListener(VAULT_UNLOCKED_EVENT, invalidate);
});
function detail(item: TaskSummary) {
  selectedId.value = item.id;
  associationOpen.value = false;
}
function closeDetails(open: boolean) {
  if (open || associationBusy.value) return;
  selectedId.value = '';
  associationOpen.value = false;
}
function goSettings() {
  globalThis.location.hash = appHash('settings');
}
function queue() {
  globalThis.location.hash = appHash('products', 'batch-publisher');
}
async function openSource(item: TaskSummary) {
  if (!context.value || item.contextChanged) return;
  const stamp = taskContextStamp(context.value),
    ticket = epoch;
  try {
    const current = await services.gateway.galleryTransferContext?.();
    if (!current || ticket !== epoch || taskContextStamp(current) !== stamp) throw new Error('context');
    if (item.source === 'video-association') {
      associationOpen.value = true;
      return;
    }
    selectedId.value = '';
    if (item.source === 'gallery') transfers?.show(item.sourceId);
    else if (item.source === 'video-upload')
      globalThis.location.hash = appHash('photos', 'videos', 'uploads', item.sourceId);
    else globalThis.location.hash = appHash('products', 'tasks', item.sourceId, 'history');
  } catch {
    clear();
    failed.value = true;
    toast.error(tt('changed'));
  }
}
async function copy(value: string) {
  try {
    await globalThis.navigator.clipboard.writeText(value);
    toast.success(tt('copied'));
  } catch {
    toast.error(tt('copyFailed'));
  }
}
function statusVariant(item: TaskSummary): 'success' | 'warning' | 'destructive' | 'secondary' {
  return item.status === 'failed'
    ? 'destructive'
    : item.status === 'confirmed'
      ? 'success'
      : needsAttention(item) || item.status === 'submitted'
        ? 'warning'
        : 'secondary';
}
function operation(item: TaskSummary) {
  const key = `tasks.operations.${item.operation}`;
  return hasUiTranslation(key) ? t(key) : tt(`sources.${item.source}`);
}
function stepStatus(value: string) {
  const key = `photos.tasks.item.${value}`;
  return hasUiTranslation(key) ? t(key) : value;
}
function stepLabel(value: string, id: string) {
  const key = `photos.tasks.kind.${value}`;
  if (hasUiTranslation(key)) return t(key);
  return /^part-\d+$/.test(value) ? tt('part', { number: id.replace(/^part-/, '') }) : value || id;
}
const columns = computed<DataColumn<TaskSummary>[]>(() => [
  {
    id: 'title',
    header: tt('taskId'),
    meta: { width: '260px' },
    cell: ({ row }) =>
      h('div', { class: 'max-w-64' }, [
        h(
          'p',
          { class: 'truncate', title: row.original.title },
          row.original.title || operation(row.original)
        ),
        h(
          'p',
          { class: 'truncate font-mono text-xs text-muted-foreground', title: row.original.sourceId },
          row.original.sourceId
        )
      ])
  },
  { id: 'source', header: tt('source'), cell: ({ row }) => tt(`sources.${row.original.source}`) },
  { id: 'operation', header: tt('operation'), cell: ({ row }) => operation(row.original) },
  {
    id: 'status',
    header: tt('status'),
    cell: ({ row }) =>
      h(Badge, { variant: statusVariant(row.original) }, () => tt(`states.${row.original.status}`))
  },
  { id: 'resource', header: tt('resource'), cell: ({ row }) => row.original.resourceId ?? '—' },
  {
    id: 'updatedAt',
    header: tt('updatedAt'),
    cell: ({ row }) =>
      h('span', { class: 'whitespace-nowrap tabular-nums' }, formatDateTime(row.original.updatedAt))
  },
  {
    id: 'requestId',
    header: 'requestId',
    cell: ({ row }) =>
      h(
        'span',
        { class: 'block max-w-48 truncate font-mono', title: row.original.requestId ?? '' },
        row.original.requestId ?? '—'
      )
  },
  {
    id: 'actions',
    header: t('common.actions.title'),
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: 'ghost',
          size: 'sm',
          onClick: () => {
            detail(row.original);
          }
        },
        () => tt('details')
      )
  }
]);
</script>

<template>
  <section class="min-w-0 space-y-4" data-testid="unified-task-center">
    <header>
      <h2 class="text-2xl font-semibold">{{ tt('title') }}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{{ tt('description') }}</p>
    </header>
    <p v-if="failed" role="alert" class="rounded-md border border-destructive/40 p-3 text-sm">
      {{ tt('unavailable') }}
      <Button size="sm" variant="ghost" @click="goSettings">{{ tt('settings') }}</Button>
    </p>
    <div v-if="errors.length" role="status" class="rounded-md border p-3 text-sm">
      <p>{{ tt('partial') }}</p>
      <ul class="mt-1 list-inside list-disc text-muted-foreground">
        <li v-for="error in errors" :key="`${error.source}:${error.code}`">
          {{ tt(`sources.${error.source}`) }} · <code>{{ error.code }}</code>
        </li>
      </ul>
      <Button size="sm" variant="ghost" @click="goSettings">{{ tt('settings') }}</Button>
    </div>
    <div v-if="unscopedQueueCount" class="rounded-md border p-3 text-sm text-muted-foreground">
      <p>{{ tt('unscoped', { count: unscopedQueueCount }) }}</p>
      <Button size="sm" variant="ghost" @click="queue">{{ tt('queue') }}</Button>
    </div>
    <div>
      <ListToolbar @search="searchTasks">
        <template #search
          ><Input
            v-model="searchText"
            class="min-w-0 flex-1"
            :placeholder="tt('search')"
            :aria-label="tt('search')"
          /><ListActionButton :icon="Search" type="submit" :disabled="busy">{{
            t('common.actions.search')
          }}</ListActionButton></template
        >
        <template #actions>
          <span class="mr-auto text-sm text-muted-foreground" aria-live="polite">{{
            tt('attention', { count: attentionCount })
          }}</span>
          <ListFilterDialog
            v-model:open="filterOpen"
            :active-count="filterCount"
            :invalid="invalidRange"
            @apply="applyFilters"
            @reset="draft = defaults()"
          >
            <label class="grid gap-1 text-sm"
              >{{ tt('source')
              }}<select v-model="draft.source" class="rounded-md border bg-background p-2">
                <option value="">{{ tt('all') }}</option>
                <option v-for="source in sources" :key="source" :value="source">
                  {{ tt(`sources.${source}`) }}
                </option>
              </select></label
            >
            <label class="grid gap-1 text-sm"
              >{{ tt('status')
              }}<select v-model="draft.status" class="rounded-md border bg-background p-2">
                <option value="">{{ tt('all') }}</option>
                <option v-for="status in states" :key="status" :value="status">
                  {{ tt(`states.${status}`) }}
                </option>
              </select></label
            >
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="grid gap-1 text-sm"
                >{{ tt('dateFrom') }}<Input v-model="draft.from" type="date" /></label
              ><label class="grid gap-1 text-sm"
                >{{ tt('dateTo') }}<Input v-model="draft.to" type="date"
              /></label>
            </div>
            <p v-if="invalidRange" role="alert" class="text-sm text-destructive">{{ tt('invalidRange') }}</p>
            <label class="flex items-center gap-2 text-sm"
              ><input v-model="draft.attentionFirst" type="checkbox" />{{ tt('attentionFirst') }}</label
            >
          </ListFilterDialog>
        </template>
      </ListToolbar>
      <DataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :columns="columns"
        :data="filtered"
        :get-row-key="(item) => item.id"
        :active-row-key="selectedId"
        column-settings-key="task-center"
        :hidden-columns="['requestId']"
        :selection-scope="JSON.stringify([identityScope, filters, search])"
        :empty-text="busy ? tt('loading') : tt('empty')"
      />
      <div
        class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span>{{ tt('loaded', { count: items.length }) }} {{ busy ? tt('loading') : '' }}</span
        ><Button v-if="productHasMore" variant="outline" size="sm" :disabled="busy" @click="load(true)">{{
          tt('more')
        }}</Button>
      </div>
    </div>
    <Sheet
      :open="!!selected"
      :title="tt('details')"
      :description="tt('snapshot')"
      @update:open="closeDetails"
    >
      <template v-if="selected">
        <h3 class="break-words font-semibold">{{ selected.title || operation(selected) }}</h3>
        <Badge class="mt-2" :variant="statusVariant(selected)">{{ tt(`states.${selected.status}`) }}</Badge>
        <p v-if="selected.accountMatch === 'unknown'" class="my-3 rounded-md border p-3 text-sm">
          <strong>{{ tt('accountUnknown') }}</strong
          ><br />{{ tt('accountUnknownHelp') }}
        </p>
        <p class="my-3 rounded-md border p-3 text-sm">
          {{ selected.contextChanged ? tt('contextChanged') : tt(`guidance.${selected.guidance}`) }}
        </p>
        <dl class="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <dt class="text-muted-foreground">{{ tt('source') }}</dt>
          <dd>{{ tt(`sources.${selected.source}`) }}</dd>
          <dt class="text-muted-foreground">{{ tt('operation') }}</dt>
          <dd>{{ operation(selected) }}</dd>
          <dt class="text-muted-foreground">{{ tt('taskId') }}</dt>
          <dd class="break-all font-mono">{{ selected.sourceId }}</dd>
          <dt class="text-muted-foreground">{{ tt('resource') }}</dt>
          <dd class="break-all">{{ selected.resourceId ?? '—' }}</dd>
          <dt class="text-muted-foreground">{{ tt('createdAt') }}</dt>
          <dd class="tabular-nums">{{ formatDateTime(selected.createdAt) }}</dd>
          <dt class="text-muted-foreground">{{ tt('updatedAt') }}</dt>
          <dd class="tabular-nums">{{ formatDateTime(selected.updatedAt) }}</dd>
          <dt class="text-muted-foreground">{{ tt('lastCheckedAt') }}</dt>
          <dd class="tabular-nums">
            {{ selected.lastCheckedAt === null ? tt('notRecorded') : formatDateTime(selected.lastCheckedAt) }}
          </dd>
          <dt class="text-muted-foreground">{{ tt('rawStatus') }}</dt>
          <dd>{{ selected.rawStatus }}</dd>
          <dt class="text-muted-foreground">requestId</dt>
          <dd class="break-all font-mono">{{ selected.requestId ?? '—' }}</dd>
          <dt class="text-muted-foreground">traceId</dt>
          <dd class="break-all font-mono">{{ selected.traceId ?? '—' }}</dd>
          <dt class="text-muted-foreground">{{ tt('receipt') }}</dt>
          <dd class="break-all">{{ selected.reasonCode ?? '—' }}</dd>
        </dl>
        <p v-if="selected.batchItemId" class="mt-3 text-sm text-muted-foreground">{{ tt('batchLinked') }}</p>
        <h4 class="mb-2 mt-6 font-medium">{{ tt('steps') }}</h4>
        <p v-if="!selected.steps.length" class="text-sm text-muted-foreground">{{ tt('noSteps') }}</p>
        <ol v-else class="max-h-80 space-y-2 overflow-y-auto rounded-md border p-3 text-sm">
          <li v-for="step in selected.steps" :key="step.id" class="border-b py-2 last:border-b-0">
            <p class="break-all">{{ stepLabel(step.label, step.id) }}</p>
            <p>{{ stepStatus(step.status) }}</p>
            <p v-if="step.requestId" class="break-all font-mono text-xs">requestId: {{ step.requestId }}</p>
            <p v-if="step.resourceId" class="break-all text-xs">ID: {{ step.resourceId }}</p>
          </li>
        </ol>
        <ProductVideoAssociation
          v-if="associationOpen && selected.source === 'video-association' && selected.resourceId"
          :product-id="selected.resourceId"
          :language="alibabaLanguage"
          blocked
          @busy="associationBusy = $event"
        />
      </template>
      <template v-if="selected" #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <ListActionButton v-if="selected.requestId" :icon="Copy" @click="copy(selected.requestId)">{{
            tt('copy')
          }}</ListActionButton>
          <ListActionButton
            v-if="
              selected.contextChanged ||
              ['login', 'unlock', 'permission', 'configuration'].includes(selected.guidance)
            "
            :icon="Settings"
            @click="goSettings"
            >{{ tt('settings') }}</ListActionButton
          >
          <ListActionButton
            v-if="!selected.contextChanged && (selected.source !== 'gallery' || transfers)"
            :icon="ArrowUpRight"
            :disabled="associationBusy"
            @click="openSource(selected)"
            >{{
              selected.source === 'video-association' ? tt('association') : tt('original')
            }}</ListActionButton
          >
        </div>
      </template>
    </Sheet>
  </section>
</template>
