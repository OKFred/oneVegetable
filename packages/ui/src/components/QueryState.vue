<script setup lang="ts">
import { AlertCircle, LoaderCircle } from '@lucide/vue';

defineProps<{ loading?: boolean; error?: Error | null }>();
</script>

<template>
  <div v-if="loading" class="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
    <LoaderCircle class="size-4 animate-spin" /> 正在加载…
  </div>
  <div v-else-if="error" class="flex min-h-40 items-center justify-center gap-2 text-sm text-destructive">
    <AlertCircle class="size-4" /> {{ error.message }}
  </div>
  <slot v-else />
</template>
