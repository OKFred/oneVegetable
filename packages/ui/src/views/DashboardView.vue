<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { Boxes, Image, PlugZap, ShoppingCart } from '@lucide/vue';

import { useServices } from '../lib/services';
import Card from '../components/ui/Card.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';

const { gateway, mode } = useServices();
const summary = useQuery({
  queryKey: ['dashboard'],
  queryFn: () => gateway.request('getDashboard', undefined)
});

function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString();
}
</script>

<template>
  <PageHeader
    title="运营总览"
    :description="
      mode === 'bff'
        ? '国际站商品、素材与订单工作台。真实请求由本地 BFF 代理。'
        : mode === 'extension'
          ? '国际站商品、素材与订单工作台。真实请求由扩展 service worker 发起。'
          : '国际站商品、素材与订单工作台。当前使用契约 Mock。'
    "
  >
    <span class="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">
      {{ mode === 'mock' ? 'OpenAPI Mock' : mode === 'bff' ? 'BFF 文档回放/代理' : 'Extension MV3' }}
    </span>
  </PageHeader>
  <QueryState :loading="summary.isPending.value" :error="summary.error.value">
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card class="p-5">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">商品</span><Boxes class="size-4 text-primary" />
        </div>
        <p class="mt-3 text-3xl font-semibold">{{ formatMetric(summary.data.value?.productCount) }}</p>
        <p class="mt-1 text-xs text-muted-foreground">Schema 发品与更新</p>
      </Card>
      <Card class="p-5">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">图库</span><Image class="size-4 text-primary" />
        </div>
        <p class="mt-3 text-3xl font-semibold">{{ formatMetric(summary.data.value?.photoCount) }}</p>
        <p class="mt-1 text-xs text-muted-foreground">总数不可确认时显示 —</p>
      </Card>
      <Card class="p-5">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">订单总数</span
          ><ShoppingCart class="size-4 text-primary" />
        </div>
        <p class="mt-3 text-3xl font-semibold">{{ formatMetric(summary.data.value?.orderCount) }}</p>
        <p class="mt-1 text-xs text-muted-foreground">订单摘要、资金与物流</p>
      </Card>
      <Card class="p-5">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">已启用能力</span><PlugZap class="size-4 text-primary" />
        </div>
        <p class="mt-3 text-3xl font-semibold">
          {{ formatMetric(summary.data.value?.enabledCapabilityCount) }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">项目内已启用的合格能力</p>
      </Card>
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
          {{ mode === 'mock' ? '契约 Mock 模式' : mode === 'bff' ? 'BFF 网关模式' : '扩展网关模式' }}
        </h2>
        <p class="mt-2 text-sm leading-6 text-amber-800 dark:text-amber-200">
          {{
            mode === 'mock'
              ? '当前数据来自本地 Mock，不会请求 Alibaba。'
              : mode === 'bff'
                ? '数据由本地 BFF 聚合；网关来源、凭据状态与请求诊断可在管理页查看。'
                : '数据由扩展 service worker 聚合，页面不会接触 App Secret。'
          }}
        </p>
      </Card>
    </div>
  </QueryState>
</template>
