<script setup lang="ts">
import { computed } from 'vue';

import type { DashboardMetricStatus } from '@one-vegetable/core';

import Card from './ui/Card.vue';

const props = defineProps<{
  title: string;
  value: number | null | undefined;
  status: DashboardMetricStatus | undefined;
  description: string;
  gatewaySourceLabel: string;
}>();

const formattedValue = computed(() =>
  props.value === null || props.value === undefined ? '—' : props.value.toLocaleString()
);
const statusText = computed(() => {
  const status = props.status;
  if (!status) return '状态检测中';
  if (status.state === 'available') {
    if (status.source === 'catalog') return '本地能力目录';
    return props.value === 0
      ? `${props.gatewaySourceLabel} · 已确认为 0`
      : `${props.gatewaySourceLabel} · 已确认`;
  }
  const reason = status.reasonCode ? ` · ${status.reasonCode}` : '';
  if (status.state === 'unknown') return `上游未提供可确认总数${reason}`;
  if (status.state === 'permission-denied') return `当前账号无权限${reason}`;
  return `接口请求失败${reason}`;
});
const statusClass = computed(() => {
  const state = props.status?.state;
  if (state === 'available') return 'text-emerald-700 dark:text-emerald-300';
  if (state === 'unknown') return 'text-amber-700 dark:text-amber-300';
  if (state === 'permission-denied' || state === 'error') {
    return 'text-rose-700 dark:text-rose-300';
  }
  return 'text-muted-foreground';
});
</script>

<template>
  <Card class="p-5">
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-muted-foreground">{{ title }}</span>
      <slot name="icon" />
    </div>
    <p class="mt-3 text-3xl font-semibold">{{ formattedValue }}</p>
    <p class="mt-1 text-xs text-muted-foreground">{{ description }}</p>
    <p class="mt-3 text-xs" :class="statusClass">{{ statusText }}</p>
  </Card>
</template>
