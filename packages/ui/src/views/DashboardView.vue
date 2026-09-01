<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Boxes, Image, PlugZap, ShoppingCart } from '@lucide/vue';

import { useServices } from '../lib/services';
import DashboardMetricCard from '../components/DashboardMetricCard.vue';
import Card from '../components/ui/Card.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import { resolveDataSource } from '../lib/data-source';
import { useUiI18n } from '../i18n';

const { gateway, mode, runtime } = useServices();
const { t } = useUiI18n();
const dataSource = computed(() => resolveDataSource(mode, runtime));
const summary = useQuery({
  queryKey: ['dashboard'],
  queryFn: () => gateway.request('getDashboard', undefined)
});
</script>

<template>
  <PageHeader
    :title="t('shell.dashboard.title')"
    :description="
      mode === 'bff'
        ? t('shell.dashboard.descriptions.bff')
        : mode === 'extension'
          ? t('shell.dashboard.descriptions.extension')
          : t('shell.dashboard.descriptions.mock')
    "
  />
  <QueryState
    :loading="summary.isPending.value"
    :error="summary.error.value"
    retryable
    @retry="summary.refetch()"
  >
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DashboardMetricCard
        :title="t('shell.dashboard.metrics.products')"
        :value="summary.data.value?.productCount"
        :status="summary.data.value?.metricStatuses.productCount"
        :description="t('shell.dashboard.metrics.productsDescription')"
        :gateway-source-label="dataSource.label"
      >
        <template #icon><Boxes class="size-4 text-primary" /></template>
      </DashboardMetricCard>
      <DashboardMetricCard
        :title="t('shell.dashboard.metrics.photos')"
        :value="summary.data.value?.photoCount"
        :status="summary.data.value?.metricStatuses.photoCount"
        :description="t('shell.dashboard.metrics.photosDescription')"
        :gateway-source-label="dataSource.label"
      >
        <template #icon><Image class="size-4 text-primary" /></template>
      </DashboardMetricCard>
      <DashboardMetricCard
        :title="t('shell.dashboard.metrics.orders')"
        :value="summary.data.value?.orderCount"
        :status="summary.data.value?.metricStatuses.orderCount"
        :description="t('shell.dashboard.metrics.ordersDescription')"
        :gateway-source-label="dataSource.label"
      >
        <template #icon><ShoppingCart class="size-4 text-primary" /></template>
      </DashboardMetricCard>
      <DashboardMetricCard
        :title="t('shell.dashboard.metrics.capabilities')"
        :value="summary.data.value?.enabledCapabilityCount"
        :status="summary.data.value?.metricStatuses.enabledCapabilityCount"
        :description="t('shell.dashboard.metrics.capabilitiesDescription')"
        :gateway-source-label="dataSource.label"
      >
        <template #icon><PlugZap class="size-4 text-primary" /></template>
      </DashboardMetricCard>
    </div>
    <div class="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card class="p-5">
        <h2 class="font-semibold">{{ t('shell.dashboard.iterationStatus') }}</h2>
        <div class="mt-4 space-y-3 text-sm">
          <div class="flex items-center justify-between rounded-lg bg-muted/60 p-3">
            <span>Manifest V3 / WXT</span
            ><span class="text-emerald-700">{{ t('shell.dashboard.migrated') }}</span>
          </div>
          <div class="flex items-center justify-between rounded-lg bg-muted/60 p-3">
            <span>{{ t('shell.dashboard.openApiContract') }}</span
            ><span class="text-emerald-700">{{ t('shell.dashboard.enabled') }}</span>
          </div>
          <div class="flex items-center justify-between rounded-lg bg-muted/60 p-3">
            <span>{{ t('shell.dashboard.legacyPublishing') }}</span
            ><span class="text-amber-700">{{ t('shell.dashboard.schemaReplacement') }}</span>
          </div>
        </div>
      </Card>
      <Card class="border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
        <h2 class="font-semibold text-amber-900 dark:text-amber-100">
          {{ dataSource.label }}
        </h2>
        <p class="mt-2 text-sm leading-6 text-amber-800 dark:text-amber-200">
          {{ dataSource.description }}
        </p>
      </Card>
    </div>
  </QueryState>
</template>
