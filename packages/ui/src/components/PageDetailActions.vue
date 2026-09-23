<script setup lang="ts">
import { toast } from 'vue-sonner';
import { watch, onScopeDispose } from 'vue';
import { Play, RefreshCw, Square } from '@lucide/vue';
import { useUiI18n } from '../i18n';
import ListActionButton from './ListActionButton.vue';
const props = defineProps<{
  busy: boolean;
  done: number;
  total: number;
  count: number;
  failed: boolean;
  aggregate?: boolean;
  pageKey: string;
  load: (retry: boolean) => Promise<{ success: number; failed: number } | null>;
}>();
const emit = defineEmits<{ stop: [] }>();
const { t } = useUiI18n();
async function start(retry: boolean): Promise<void> {
  const result = await props.load(retry);
  if (result) toast(t('common.columns.result', result));
}
let pending = false;
watch(
  () => props.pageKey,
  () => {
    pending = true;
    emit('stop');
  },
  { immediate: true }
);
watch(
  () => [props.pageKey, props.busy, props.count] as const,
  () => {
    if (pending && !props.busy && props.count > 0) {
      pending = false;
      void props.load(false);
    }
  },
  { immediate: true, flush: 'post' }
);
onScopeDispose(() => {
  emit('stop');
});
</script>
<template>
  <div
    v-if="busy || failed || (done > 0 && done < total)"
    class="flex flex-wrap items-center justify-end gap-2 border-t px-3 py-1 text-xs"
  >
    <template v-if="busy"
      ><span aria-live="polite">{{ t('common.columns.progress', { done, total }) }}</span
      ><ListActionButton :icon="Square" @click="emit('stop')">{{
        t('common.columns.stop')
      }}</ListActionButton></template
    >
    <template v-else
      ><ListActionButton v-if="!failed && done < total" :icon="Play" @click="start(false)">{{
        t('common.columns.resume')
      }}</ListActionButton
      ><ListActionButton v-if="failed" :icon="RefreshCw" @click="start(true)">{{
        t('common.columns.retry')
      }}</ListActionButton></template
    >
  </div>
</template>
