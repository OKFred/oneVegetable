<script setup lang="ts">
import { useUiI18n } from '../i18n';
import ContentSkeleton from './ContentSkeleton.vue';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import type { MediaErrorFeature } from '../lib/media-error-guidance';

withDefaults(
  defineProps<{
    loading?: boolean;
    refreshing?: boolean;
    hasContent?: boolean;
    layout?: 'page' | 'panel' | 'table' | 'authorization';
    error?: Error | null;
    retryable?: boolean;
    retryLabel?: string;
    mediaFeature?: MediaErrorFeature | undefined;
  }>(),
  {
    loading: false,
    refreshing: false,
    hasContent: false,
    layout: 'table',
    error: null,
    retryable: false,
    retryLabel: '',
    mediaFeature: undefined
  }
);

defineEmits<{ retry: [] }>();
const { t } = useUiI18n();
</script>

<template>
  <ContentSkeleton v-if="loading && !hasContent" :layout="layout" />
  <div v-else class="relative min-w-0" :aria-busy="loading || refreshing">
    <div v-if="loading || refreshing" role="status" class="pointer-events-none absolute inset-x-0 top-0 z-20">
      <div class="h-0.5 rounded bg-primary/50 motion-safe:animate-pulse" aria-hidden="true" />
      <span class="sr-only">{{ t('common.loadingFeedback.refreshing') }}</span>
    </div>
    <div v-if="error" class="flex min-h-40 flex-col items-center justify-center gap-3 p-4">
      <ErrorNotice :error="error" :media-feature="mediaFeature" class="w-full max-w-2xl" />
      <Button v-if="retryable" variant="outline" size="sm" @click="$emit('retry')">{{
        retryLabel || t('common.actions.retry')
      }}</Button>
    </div>
    <slot v-if="!error || hasContent" />
  </div>
</template>
