<script setup lang="ts">
import { computed } from 'vue';

import type { DashboardMetricStatus } from '@one-vegetable/core';

import { useUiI18n } from '../i18n';
import Card from './ui/Card.vue';
import Tooltip from './ui/Tooltip.vue';

const props = defineProps<{
  title: string;
  value: number | null | undefined;
  status: DashboardMetricStatus | undefined;
  description: string;
  gatewaySourceLabel: string;
}>();
const { t } = useUiI18n();

const formattedValue = computed(() =>
  props.value === null || props.value === undefined ? '—' : props.value.toLocaleString()
);
const statusText = computed(() => {
  const status = props.status;
  if (!status) return t('common.metric.checking');
  if (status.state === 'available') {
    if (status.source === 'catalog') return t('common.metric.localCatalog');
    return props.value === 0
      ? t('common.metric.confirmedZero', { source: props.gatewaySourceLabel })
      : t('common.metric.confirmed', { source: props.gatewaySourceLabel });
  }
  const reason = status.reasonCode ? ` · ${status.reasonCode}` : '';
  if (status.state === 'unknown') return t('common.metric.upstreamUnknown', { reason });
  if (status.state === 'permission-denied') return t('common.metric.permissionDenied', { reason });
  return t('common.metric.requestFailed', { reason });
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
const details = computed(() => `${props.description} · ${statusText.value}`);
const shortStatus = computed(() =>
  t(
    !props.status
      ? 'common.actions.loading'
      : props.status.state === 'permission-denied'
        ? 'common.columns.denied'
        : props.status.state === 'unknown'
          ? 'common.columns.missing'
          : 'common.columns.failed'
  )
);
</script>

<template>
  <Card class="h-full min-w-0 p-5">
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-muted-foreground">{{ title }}</span>
      <Tooltip :text="details">
        <button
          type="button"
          :aria-label="`${title}: ${details}`"
          class="rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <slot name="icon" />
        </button>
      </Tooltip>
    </div>
    <p class="mt-3 text-3xl font-semibold">{{ formattedValue }}</p>
    <p v-if="status?.state !== 'available'" class="mt-2 text-xs" :class="statusClass">{{ shortStatus }}</p>
  </Card>
</template>
