<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { ExternalLink, RefreshCw } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { productMutationJobIsBlocking, type ProductMutationJob } from '@one-vegetable/core';
import type { ProductBatchPublishItem } from '../lib/product-batch-publish';
import type { DataColumn } from '../lib/table';
import { formatDateTime } from '../lib/date-time';
import { useUiI18n } from '../i18n';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import DataTable from './DataTable.vue';
import ListActionButton from './ListActionButton.vue';
import ListFilterDialog from './ListFilterDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import PlatformReadbackNotice from './PlatformReadbackNotice.vue';
import { productReadbackNotice } from '../lib/platform-readback-notice';
import { productMutationMessage } from '../lib/product-mutation-presentation';

const ALIBABA_PRODUCT_MANAGEMENT_URL = 'https://i.alibaba.com/products/list-manage';
const props = defineProps<{
  jobs: ProductMutationJob[];
  batchItems: ProductBatchPublishItem[];
  loading: boolean;
  error: unknown;
  refreshingJobId: string;
  detailUrls: Record<string, string>;
}>();
const emit = defineEmits<{
  refresh: [];
  'refresh-job': [job: ProductMutationJob];
  recover: [job: ProductMutationJob];
}>();
const { t } = useUiI18n();
const filterOpen = ref(false);
const statuses = ref<ProductMutationJob['status'][]>([]);
const draftStatuses = ref<ProductMutationJob['status'][]>([]);
const availableStatuses: ProductMutationJob['status'][] = [
  'submitted',
  'auditing',
  'verifying',
  'verified',
  'recovery-required',
  'recovering',
  'recovered',
  'failed'
];
watch(filterOpen, (open) => {
  if (open) draftStatuses.value = [...statuses.value];
});
function applyFilters(): void {
  statuses.value = [...draftStatuses.value];
  filterOpen.value = false;
}
const filteredJobs = computed(() =>
  props.jobs.filter((job) => !statuses.value.length || statuses.value.includes(job.status))
);
const pendingCount = computed(
  () => props.jobs.filter((job) => productMutationJobIsBlocking(job.status)).length
);
const attentionCount = computed(
  () =>
    props.jobs.filter((job) => job.status === 'recovery-required' || job.status === 'failed').length +
    props.batchItems.filter((item) => item.status === 'attention-required').length
);
const verifiedCount = computed(
  () => props.jobs.filter((job) => job.status === 'verified' || job.status === 'recovered').length
);

function jobStatusLabel(status: ProductMutationJob['status']): string {
  return t('products.view.mutationStatus.' + (status === 'recovery-required' ? 'recoveryRequired' : status));
}
function statusVariant(status: ProductMutationJob['status']): 'success' | 'warning' | 'destructive' {
  if (status === 'verified' || status === 'recovered') return 'success';
  if (productMutationJobIsBlocking(status) && status !== 'recovery-required') return 'warning';
  return 'destructive';
}
function batchStatusLabel(status: ProductBatchPublishItem['status']): string {
  const key =
    status === 'draft-saved' ? 'draft' : status === 'attention-required' ? 'attentionRequired' : status;
  return t('products.batch.storedStatus.' + key);
}
function openAlibabaProductManagement(): void {
  globalThis.open(ALIBABA_PRODUCT_MANAGEMENT_URL, '_blank', 'noopener,noreferrer');
}
async function copyRequestId(job: ProductMutationJob): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(job.requestId);
    toast.success(t('common.actions.copied'));
  } catch {
    toast.error(t('common.error.copyFailed'));
  }
}
const columns = computed<DataColumn<ProductMutationJob>[]>(() => [
  {
    accessorKey: 'operation',
    header: t('products.tasks.columns.operation'),
    cell: ({ row }) => t('products.tasks.operations.' + row.original.operation)
  },
  {
    accessorKey: 'productId',
    header: t('products.tasks.columns.product'),
    cell: ({ row }) =>
      h('div', { class: 'flex items-center gap-2' }, [
        h('span', { class: 'font-mono' }, row.original.productId),
        props.detailUrls[row.original.productId]
          ? h(
              'a',
              {
                href: props.detailUrls[row.original.productId],
                target: '_blank',
                rel: 'noopener noreferrer',
                class: 'text-muted-foreground hover:text-foreground',
                'aria-label': t('products.links.viewOnAlibaba')
              },
              [h(ExternalLink, { class: 'size-3.5' })]
            )
          : null
      ])
  },
  {
    accessorKey: 'status',
    header: t('products.tasks.columns.status'),
    cell: ({ row }) =>
      h('div', { class: 'max-w-80' }, [
        h(Badge, { variant: statusVariant(row.original.status) }, () => jobStatusLabel(row.original.status)),
        h(PlatformReadbackNotice, { kind: productReadbackNotice(row.original.status), class: 'mt-2' }),
        row.original.message || row.original.reasonCode
          ? h('p', { class: 'mt-1 text-xs text-muted-foreground' }, productMutationMessage(row.original))
          : null
      ])
  },
  {
    accessorKey: 'requestId',
    header: 'requestId',
    cell: ({ row }) => h('code', { class: 'inline-block max-w-60 break-all text-xs' }, row.original.requestId)
  },
  {
    accessorKey: 'updateTimeUtc',
    header: t('products.tasks.columns.updatedAt'),
    cell: ({ row }) =>
      h('span', { class: 'whitespace-nowrap tabular-nums' }, formatDateTime(row.original.updateTimeUtc))
  },
  {
    id: 'actions',
    header: t('products.tasks.columns.actions'),
    cell: ({ row }) =>
      h('div', { class: 'flex gap-2' }, [
        productMutationJobIsBlocking(row.original.status)
          ? h(
              Button,
              {
                size: 'sm',
                variant: 'outline',
                disabled: props.refreshingJobId === row.original.id,
                onClick: () => {
                  emit('refresh-job', row.original);
                }
              },
              () => t('products.tasks.check')
            )
          : null,
        row.original.operation === 'updateProductDisplay' && row.original.status === 'recovery-required'
          ? h(
              Button,
              {
                size: 'sm',
                variant: 'destructive',
                onClick: () => {
                  emit('recover', row.original);
                }
              },
              () => t('products.view.page.recover')
            )
          : null,
        h(Button, { size: 'sm', variant: 'ghost', onClick: () => void copyRequestId(row.original) }, () =>
          t('common.actions.copyId')
        )
      ])
  }
]);
const batchColumns = computed<DataColumn<ProductBatchPublishItem>[]>(() => [
  {
    accessorKey: 'title',
    header: t('products.batch.columns.product'),
    cell: ({ row }) =>
      h('p', { class: 'max-w-80 truncate font-medium', title: row.original.title }, row.original.title)
  },
  {
    id: 'productId',
    header: t('insights.columns.productId'),
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.platformProductId ?? row.original.id)
  },
  {
    accessorKey: 'status',
    header: t('products.batch.columns.status'),
    cell: ({ row }) =>
      h(Badge, { variant: row.original.status === 'attention-required' ? 'destructive' : 'secondary' }, () =>
        batchStatusLabel(row.original.status)
      )
  }
]);
</script>

<template>
  <div class="space-y-5">
    <div class="grid gap-3 sm:grid-cols-3">
      <Card class="p-4"
        ><p class="text-sm text-muted-foreground">{{ t('products.tasks.pending') }}</p>
        <p class="mt-2 text-2xl font-semibold tabular-nums">{{ pendingCount }}</p></Card
      >
      <Card class="p-4"
        ><p class="text-sm text-muted-foreground">{{ t('products.tasks.attention') }}</p>
        <p class="mt-2 text-2xl font-semibold tabular-nums text-destructive">{{ attentionCount }}</p></Card
      >
      <Card class="p-4"
        ><p class="text-sm text-muted-foreground">{{ t('products.tasks.verified') }}</p>
        <p class="mt-2 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          {{ verifiedCount }}
        </p></Card
      >
    </div>
    <Card class="overflow-hidden">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b p-5">
        <div>
          <h2 class="font-semibold">{{ t('products.tasks.platformTitle') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('products.tasks.platformDescription') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <ListFilterDialog
            v-model:open="filterOpen"
            :active-count="Number(statuses.length > 0)"
            @apply="applyFilters"
            @reset="draftStatuses = []"
          >
            <fieldset class="space-y-2">
              <legend class="mb-2 text-sm font-medium">{{ t('products.tasks.columns.status') }}</legend>
              <label v-for="status in availableStatuses" :key="status" class="flex items-center gap-2 text-sm"
                ><input v-model="draftStatuses" type="checkbox" :value="status" />{{
                  jobStatusLabel(status)
                }}</label
              >
            </fieldset>
          </ListFilterDialog>
          <ListActionButton
            :icon="RefreshCw"
            :icon-class="loading ? 'animate-spin' : ''"
            :disabled="loading"
            @click="emit('refresh')"
          >
            {{ t('common.actions.refresh') }}
          </ListActionButton>
          <ListActionButton :icon="ExternalLink" @click="openAlibabaProductManagement">
            {{ t('products.tasks.openManagement') }}
          </ListActionButton>
        </div>
      </div>
      <ErrorNotice v-if="error" class="m-4" :error="error" compact />
      <DataTable
        :columns="columns"
        :data="filteredJobs"
        :get-row-key="(job) => job.id"
        column-settings-key="product-mutation-jobs"
        :selection-scope="statuses.join(',')"
        :empty-text="t('products.tasks.empty')"
        min-width="980px"
        max-height="62vh"
      />
    </Card>
    <Card v-if="batchItems.length" class="overflow-hidden">
      <div class="border-b p-5">
        <h2 class="font-semibold">{{ t('products.tasks.localBatchTitle') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('products.tasks.localBatchDescription') }}</p>
      </div>
      <DataTable
        :columns="batchColumns"
        :data="batchItems"
        :get-row-key="(item) => item.id"
        column-settings-key="product-task-batch"
        max-height="320px"
      />
    </Card>
  </div>
</template>
