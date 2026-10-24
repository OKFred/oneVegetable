<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useUiI18n } from '../i18n';

withDefaults(defineProps<{ layout?: 'page' | 'panel' | 'table' | 'authorization'; title?: string }>(), {
  layout: 'panel',
  title: ''
});
const { t } = useUiI18n();
const slow = ref(false);
let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
onMounted(() => {
  timer = globalThis.setTimeout(() => {
    slow.value = true;
  }, 8000);
});
onUnmounted(() => {
  globalThis.clearTimeout(timer);
});
</script>

<template>
  <div
    class="min-w-0 space-y-4 rounded-xl border bg-card p-5"
    :class="layout === 'page' ? 'min-h-96' : 'min-h-40'"
    role="status"
    aria-live="polite"
    aria-busy="true"
    :data-skeleton-layout="layout"
  >
    <h2 v-if="title" class="font-semibold">{{ title }}</h2>
    <div class="space-y-4 motion-safe:animate-pulse" aria-hidden="true">
      <div v-if="layout === 'page'" class="space-y-3 pb-2">
        <div class="h-6 w-40 rounded bg-muted" />
        <div class="h-3 w-2/3 rounded bg-muted" />
      </div>
      <div v-if="layout === 'authorization' || layout === 'page'" class="grid gap-3 sm:grid-cols-2">
        <div v-for="item in 2" :key="item" class="space-y-4 rounded-lg border p-4">
          <div class="h-4 w-20 rounded bg-muted" />
          <div class="h-3 w-2/3 rounded bg-muted" />
          <div class="flex gap-2 pt-2">
            <div class="h-9 w-16 rounded bg-muted" />
            <div class="h-9 w-16 rounded bg-muted" />
          </div>
        </div>
      </div>
      <div v-else-if="layout === 'table'" class="space-y-3">
        <div class="h-8 rounded bg-muted" />
        <div
          v-for="row in 4"
          :key="row"
          class="grid grid-cols-[3rem_1fr_1fr] gap-4 border-b py-2 last:border-0"
        >
          <div class="h-8 rounded bg-muted" />
          <div class="my-2 rounded bg-muted" />
          <div class="my-2 rounded bg-muted" />
        </div>
      </div>
      <div v-else class="space-y-4">
        <div class="h-4 w-1/3 rounded bg-muted" />
        <div class="h-3 w-5/6 rounded bg-muted" />
        <div class="h-9 rounded bg-muted" />
      </div>
    </div>
    <p class="min-h-5 text-sm text-muted-foreground">
      {{ t(slow ? 'common.loadingFeedback.slow' : 'common.actions.loading') }}
    </p>
  </div>
</template>
