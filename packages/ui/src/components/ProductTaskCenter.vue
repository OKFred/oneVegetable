<script setup lang="ts">
import { computed } from 'vue';
import { ExternalLink, RefreshCw } from '@lucide/vue';

import { productMutationJobIsBlocking, type ProductMutationJob } from '@one-vegetable/core';

import type { ProductBatchPublishItem } from '../lib/product-batch-publish';
import { formatDateTime } from '../lib/date-time';
import { useUiI18n } from '../i18n';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import ErrorNotice from './ErrorNotice.vue';

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

function operationLabel(operation: ProductMutationJob['operation']): string {
  return t(`products.tasks.operations.${operation}`);
}

function jobStatusLabel(status: ProductMutationJob['status']): string {
  return t(`products.view.mutationStatus.${status === 'recovery-required' ? 'recoveryRequired' : status}`);
}

function statusVariant(
  status: ProductMutationJob['status']
): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'verified' || status === 'recovered') return 'success';
  if (productMutationJobIsBlocking(status) && status !== 'recovery-required') return 'warning';
  return 'destructive';
}

function batchStatusLabel(status: ProductBatchPublishItem['status']): string {
  const key =
    status === 'draft-saved' ? 'draft' : status === 'attention-required' ? 'attentionRequired' : status;
  return t(`products.batch.storedStatus.${key}`);
}

function openAlibabaProductManagement(): void {
  globalThis.open(ALIBABA_PRODUCT_MANAGEMENT_URL, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <div class="space-y-5">
    <div class="grid gap-3 sm:grid-cols-3">
      <Card class="p-4">
        <p class="text-sm text-muted-foreground">{{ t('products.tasks.pending') }}</p>
        <p class="mt-2 text-2xl font-semibold tabular-nums">{{ pendingCount }}</p>
      </Card>
      <Card class="p-4">
        <p class="text-sm text-muted-foreground">{{ t('products.tasks.attention') }}</p>
        <p class="mt-2 text-2xl font-semibold tabular-nums text-destructive">{{ attentionCount }}</p>
      </Card>
      <Card class="p-4">
        <p class="text-sm text-muted-foreground">{{ t('products.tasks.verified') }}</p>
        <p class="mt-2 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          {{ verifiedCount }}
        </p>
      </Card>
    </div>

    <Card class="overflow-hidden">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b p-5">
        <div>
          <h2 class="font-semibold">{{ t('products.tasks.platformTitle') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('products.tasks.platformDescription') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" :disabled="loading" @click="emit('refresh')">
            <RefreshCw class="size-4" :class="{ 'animate-spin': loading }" />
            {{ t('common.actions.refresh') }}
          </Button>
          <Button variant="outline" @click="openAlibabaProductManagement">
            {{ t('products.tasks.openManagement') }}<ExternalLink class="size-4" />
          </Button>
        </div>
      </div>
      <ErrorNotice v-if="error" class="m-4" :error="error" compact />
      <div class="max-h-[62vh] overflow-auto">
        <table class="w-full min-w-[980px] border-collapse text-sm">
          <thead class="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr class="border-b text-left">
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.tasks.columns.operation') }}</th>
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.tasks.columns.product') }}</th>
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.tasks.columns.status') }}</th>
              <th class="whitespace-nowrap px-4 py-3">requestId</th>
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.tasks.columns.updatedAt') }}</th>
              <th class="whitespace-nowrap px-4 py-3 text-right">
                {{ t('products.tasks.columns.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="jobs.length === 0">
              <td colspan="6" class="px-4 py-12 text-center text-muted-foreground">
                {{ t('products.tasks.empty') }}
              </td>
            </tr>
            <tr v-for="job in jobs" :key="job.id" class="border-b last:border-0">
              <td class="whitespace-nowrap px-4 py-3">{{ operationLabel(job.operation) }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <span class="font-mono">{{ job.productId }}</span>
                  <a
                    v-if="detailUrls[job.productId]"
                    :href="detailUrls[job.productId]"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="cursor-pointer text-muted-foreground hover:text-foreground"
                    :aria-label="t('products.links.viewOnAlibaba')"
                  >
                    <ExternalLink class="size-3.5" />
                  </a>
                </div>
              </td>
              <td class="whitespace-nowrap px-4 py-3">
                <Badge :variant="statusVariant(job.status)">{{ jobStatusLabel(job.status) }}</Badge>
                <p v-if="job.message" class="mt-1 max-w-80 text-xs text-muted-foreground">
                  {{ job.message }}
                </p>
              </td>
              <td class="max-w-60 break-all px-4 py-3 font-mono text-xs">{{ job.requestId }}</td>
              <td class="whitespace-nowrap px-4 py-3 tabular-nums">
                {{ formatDateTime(job.updateTimeUtc) }}
              </td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-2">
                  <Button
                    v-if="productMutationJobIsBlocking(job.status)"
                    size="sm"
                    variant="outline"
                    :disabled="refreshingJobId === job.id"
                    @click="emit('refresh-job', job)"
                  >
                    {{ t('products.tasks.check') }}
                  </Button>
                  <Button
                    v-if="job.operation === 'updateProductDisplay' && job.status === 'recovery-required'"
                    size="sm"
                    variant="destructive"
                    @click="emit('recover', job)"
                  >
                    {{ t('products.view.page.recover') }}
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <Card v-if="batchItems.length" class="overflow-hidden">
      <div class="border-b p-5">
        <h2 class="font-semibold">{{ t('products.tasks.localBatchTitle') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('products.tasks.localBatchDescription') }}</p>
      </div>
      <div class="max-h-80 overflow-auto">
        <div
          v-for="item in batchItems"
          :key="item.id"
          class="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 last:border-0"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">{{ item.title }}</p>
            <p class="mt-1 font-mono text-xs text-muted-foreground">
              {{ item.platformProductId ?? item.id }}
            </p>
          </div>
          <Badge :variant="item.status === 'attention-required' ? 'destructive' : 'secondary'">
            {{ batchStatusLabel(item.status) }}
          </Badge>
        </div>
      </div>
    </Card>
  </div>
</template>
