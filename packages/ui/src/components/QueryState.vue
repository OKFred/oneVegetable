<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue';

import ErrorNotice from './ErrorNotice.vue';

defineProps<{ loading?: boolean; error?: Error | null }>();
</script>

<template>
  <div v-if="loading" class="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
    <LoaderCircle class="size-4 animate-spin" /> 正在加载…
  </div>
  <div v-else-if="error" class="flex min-h-40 items-center justify-center p-4">
    <ErrorNotice :error="error" class="w-full max-w-2xl" />
  </div>
  <slot v-else />
</template>
