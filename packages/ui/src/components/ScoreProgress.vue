<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  label: string;
  value: number;
  max: number;
}>();

const normalizedValue = computed(() => Math.min(Math.max(props.value, 0), props.max));
const percentage = computed(() => (props.max > 0 ? (normalizedValue.value / props.max) * 100 : 0));

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center justify-between gap-3 text-sm">
      <span class="text-muted-foreground">{{ label }}</span>
      <span class="font-medium tabular-nums">{{ formatScore(value) }}/{{ formatScore(max) }}</span>
    </div>
    <div
      class="h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      :aria-label="label"
      :aria-valuemin="0"
      :aria-valuemax="max"
      :aria-valuenow="normalizedValue"
    >
      <div
        class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
        :style="{ width: `${percentage}%` }"
      />
    </div>
  </div>
</template>
