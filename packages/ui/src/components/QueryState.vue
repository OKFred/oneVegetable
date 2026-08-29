<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue';

import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';

withDefaults(
  defineProps<{
    loading?: boolean;
    error?: Error | null;
    retryable?: boolean;
    retryLabel?: string;
  }>(),
  { loading: false, error: null, retryable: false, retryLabel: '重新加载' }
);

defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="loading" class="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
    <LoaderCircle class="size-4 animate-spin" /> 正在加载…
  </div>
  <div v-else-if="error" class="flex min-h-40 flex-col items-center justify-center gap-3 p-4">
    <ErrorNotice :error="error" class="w-full max-w-2xl" />
    <Button v-if="retryable" variant="outline" size="sm" @click="$emit('retry')">{{ retryLabel }}</Button>
  </div>
  <slot v-else />
</template>
