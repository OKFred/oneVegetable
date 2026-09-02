<script setup lang="ts">
import { useUiI18n } from '../i18n';

const { t } = useUiI18n();
</script>

<template>
  <div class="space-y-3 rounded-lg border p-5" role="status" aria-live="polite">
    <div class="h-5 w-40 animate-pulse rounded bg-muted"></div>
    <div class="h-3 w-2/3 animate-pulse rounded bg-muted"></div>
    <div class="grid gap-3 pt-2 sm:grid-cols-2">
      <div class="h-20 animate-pulse rounded bg-muted/70"></div>
      <div class="h-20 animate-pulse rounded bg-muted/70"></div>
    </div>
    <span class="sr-only">{{ t('products.editor.loading') }}</span>
  </div>
</template>
