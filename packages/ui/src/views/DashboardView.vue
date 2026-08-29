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

const { gateway, mode, runtime } = useServices();
const dataSource = computed(() => resolveDataSource(mode, runtime));
const summary = useQuery({
  queryKey: ['dashboard'],
  queryFn: () => gateway.request('getDashboard', undefined)
});
</script>

<template>
  <PageHeader
    title="运营总览"
    :description="
      mode === 'bff'
        ? '国际站商品、素材与订单工作台。真实请求由本地 BFF 代理。'
        : mode === 'extension'
          ? '国际站商品、素材与订单工作台。真实请求由扩展 service worker 发起。'
          : '国际站商品、素材与订单工作台。当前使用本地契约演示数据。'
    "
  >
    <span class="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">
      {{ dataSource.label }}
    </span>
  </PageHeader>
  <QueryState
    :loading="summary.isPending.value"
    :error="summary.error.value"
    retryable
    @retry="summary.refetch()"
  >
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DashboardMetricCard
        title="商品"
        :value="summary.data.value?.productCount"
        :status="summary.data.value?.metricStatuses.productCount"
        description="Schema 发品与更新"
        :gateway-source-label="dataSource.label"
      >
        <template #icon><Boxes class="size-4 text-primary" /></template>
      </DashboardMetricCard>
      <DashboardMetricCard
        title="图库"
        :value="summary.data.value?.photoCount"
        :status="summary.data.value?.metricStatuses.photoCount"
        description="图库素材总数"
        :gateway-source-label="dataSource.label"
      >
        <template #icon><Image class="size-4 text-primary" /></template>
      </DashboardMetricCard>
      <DashboardMetricCard
        title="订单总数"
        :value="summary.data.value?.orderCount"
        :status="summary.data.value?.metricStatuses.orderCount"
        description="订单摘要、资金与物流"
        :gateway-source-label="dataSource.label"
      >
        <template #icon><ShoppingCart class="size-4 text-primary" /></template>
      </DashboardMetricCard>
      <DashboardMetricCard
        title="已启用能力"
        :value="summary.data.value?.enabledCapabilityCount"
        :status="summary.data.value?.metricStatuses.enabledCapabilityCount"
        description="项目内已启用的合格能力"
        :gateway-source-label="dataSource.label"
      >
        <template #icon><PlugZap class="size-4 text-primary" /></template>
      </DashboardMetricCard>
    </div>
    <div class="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card class="p-5">
        <h2 class="font-semibold">本迭代状态</h2>
        <div class="mt-4 space-y-3 text-sm">
          <div class="flex items-center justify-between rounded-lg bg-muted/60 p-3">
            <span>Manifest V3 / WXT</span><span class="text-emerald-700">已迁移</span>
          </div>
          <div class="flex items-center justify-between rounded-lg bg-muted/60 p-3">
            <span>OpenAPI 3.1 契约</span><span class="text-emerald-700">已启用</span>
          </div>
          <div class="flex items-center justify-between rounded-lg bg-muted/60 p-3">
            <span>旧版发品流程</span><span class="text-amber-700">Schema 替代</span>
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
