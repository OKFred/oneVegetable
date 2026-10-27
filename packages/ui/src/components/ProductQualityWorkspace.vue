<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeft, ClipboardCheck, RefreshCw, Square } from '@lucide/vue';
import { createProductScoreOfficialHints, type Product, type ProductScore } from '@one-vegetable/core';
import { useUiI18n } from '../i18n';
import { formatDateTime } from '../lib/date-time';
import PageHeader from './PageHeader.vue';
import ListActionButton from './ListActionButton.vue';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';

const props = defineProps<{
  products: Product[];
  results: Record<string, { score: ProductScore; at: number; stale: boolean }>;
  states: Record<string, 'loading' | 'ready' | 'failed'>;
  errors: Record<string, unknown>;
  busy: boolean;
  done: number;
  total: number;
}>();
const emit = defineEmits<{
  run: [refresh: boolean, failedOnly: boolean];
  stop: [];
  close: [];
  edit: [product: Product];
}>();
const { t } = useUiI18n();
const failed = computed(() => Object.keys(props.errors).length > 0);
function messages(productId: string) {
  return createProductScoreOfficialHints(props.results[productId]?.score.issues ?? []);
}
</script>

<template>
  <section data-testid="product-quality-workspace">
    <PageHeader :title="t('productQuality.title')" :description="t('productQuality.intro')" />
    <div class="mb-4 flex flex-wrap justify-end gap-2">
      <ListActionButton :icon="ArrowLeft" @click="emit('close')">{{
        t('productQuality.back')
      }}</ListActionButton>
      <ListActionButton v-if="failed" :icon="RefreshCw" :disabled="busy" @click="emit('run', true, true)">{{
        t('productQuality.retry')
      }}</ListActionButton>
      <ListActionButton
        :icon="ClipboardCheck"
        :disabled="busy || !products.length"
        @click="emit('run', Object.keys(results).length > 0, false)"
        >{{
          t(Object.keys(results).length ? 'productQuality.recheck' : 'productQuality.start')
        }}</ListActionButton
      >
      <ListActionButton v-if="busy" :icon="Square" @click="emit('stop')">{{
        t('productQuality.stop')
      }}</ListActionButton>
    </div>
    <p class="mb-3 text-xs text-muted-foreground">{{ t('productQuality.reportScope') }}</p>
    <p v-if="total" role="status" aria-live="polite" class="mb-4 text-sm">
      {{ t('productQuality.progress', { done, total }) }}
    </p>
    <div class="space-y-3">
      <Card v-for="product in products" :key="product.id" class="p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h2 class="break-words font-medium">{{ product.subject }}</h2>
            <p class="text-xs text-muted-foreground">{{ product.id }}</p>
          </div>
          <div class="text-sm tabular-nums">
            {{ t('productQuality.score') }}：{{
              states[product.id] === 'loading'
                ? t('productQuality.querying')
                : (results[product.id]?.score.score ?? t('productQuality.pending'))
            }}
          </div>
          <Button variant="outline" @click="emit('edit', product)">{{ t('productQuality.edit') }}</Button>
        </div>
        <ErrorNotice v-if="errors[product.id]" :error="errors[product.id]" compact class="mt-3" />
        <template v-if="results[product.id]">
          <p class="mt-2 text-xs text-muted-foreground">
            {{ t('productQuality.queriedAt') }}：{{ formatDateTime(results[product.id]!.at) }}
          </p>
          <p
            v-if="results[product.id]!.stale"
            role="status"
            class="mt-2 text-sm text-amber-700 dark:text-amber-400"
          >
            {{ t('productQuality.stale') }}
          </p>
          <details v-if="messages(product.id).length" class="mt-3 text-sm">
            <summary class="cursor-pointer">
              {{ t('productQuality.details') }} · {{ messages(product.id).length }}
            </summary>
            <ul class="mt-2 list-disc space-y-1 pl-5">
              <li v-for="message in messages(product.id)" :key="message.id">{{ message.text }}</li>
            </ul>
          </details>
          <p v-else class="mt-3 text-xs text-muted-foreground">{{ t('productQuality.noDetails') }}</p>
        </template>
      </Card>
    </div>
    <p class="mt-4 text-xs text-muted-foreground">{{ t('productQuality.delay') }}</p>
  </section>
</template>
