<script setup lang="ts">
import { toast } from 'vue-sonner';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
const props = defineProps<{
  busy: boolean;
  done: number;
  total: number;
  count: number;
  failed: boolean;
  aggregate?: boolean;
  load: (retry: boolean) => Promise<{ success: number; failed: number } | null>;
}>();
const emit = defineEmits<{ stop: [] }>();
const { t } = useUiI18n();
async function start(retry: boolean): Promise<void> {
  const result = await props.load(retry);
  if (result) toast(t('common.columns.result', result));
}
</script>
<template>
  <span class="text-xs text-muted-foreground"
    >{{ t('common.columns.requests', { count })
    }}<template v-if="aggregate"> · {{ t('common.columns.aggregate') }}</template></span
  >
  <template v-if="busy"
    ><span aria-live="polite">{{ t('common.columns.progress', { done, total }) }}</span
    ><Button variant="outline" @click="emit('stop')">{{ t('common.columns.stop') }}</Button></template
  >
  <template v-else
    ><Button variant="outline" :disabled="count === 0" @click="start(false)">{{
      t('common.columns.load')
    }}</Button
    ><Button v-if="failed" variant="outline" @click="start(true)">{{
      t('common.columns.retry')
    }}</Button></template
  >
</template>
