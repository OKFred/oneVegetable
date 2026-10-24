<script setup lang="ts">
import { useUiI18n } from '../i18n';
import ErrorNotice from './ErrorNotice.vue';

defineProps<{ error: Error }>();
const { t } = useUiI18n();
</script>

<template>
  <div class="space-y-3 rounded-xl border bg-card p-5" role="alert">
    <p class="text-sm">{{ t('common.loadingFeedback.componentFailed') }}</p>
    <ErrorNotice :error="error" />
  </div>
</template>
