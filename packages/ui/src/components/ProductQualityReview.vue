<script setup lang="ts">
import { computed } from 'vue';
import {
  createProductScoreOfficialHints,
  type ProductSchemaModel,
  type ProductScore,
  type ProductDescriptionQualityIssue
} from '@one-vegetable/core';
import { productQualityFieldReferences } from '../lib/product-quality';
import { useUiI18n } from '../i18n';
import Card from './ui/Card.vue';
import Button from './ui/Button.vue';
import ErrorNotice from './ErrorNotice.vue';
const props = defineProps<{
  model: ProductSchemaModel;
  score?: ProductScore | undefined;
  stale: boolean;
  pending: boolean;
  issues: ProductDescriptionQualityIssue[];
  taskId?: string | undefined;
  error?: unknown;
}>();
const emit = defineEmits<{ locate: [references: string[]]; refresh: []; task: [] }>();
const { t } = useUiI18n();
const platform = computed(() => createProductScoreOfficialHints(props.score?.issues ?? []));
const local = computed(() => props.issues.filter((issue) => issue.source === 'project'));
</script>
<template>
  <Card class="mb-4 p-4" data-testid="product-quality-review">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-medium">
        {{ t('productQuality.title') }} · {{ t('productQuality.score') }}
        {{ score?.score ?? t('productQuality.pending') }}
      </h2>
      <div class="flex flex-wrap gap-2">
        <Button v-if="taskId" variant="outline" @click="emit('task')">{{ t('productQuality.task') }}</Button>
        <Button variant="outline" :disabled="pending" @click="emit('refresh')">{{
          t(pending ? 'productQuality.querying' : 'productQuality.recheck')
        }}</Button>
      </div>
    </div>
    <p role="status" class="mt-2 text-xs text-muted-foreground">
      {{ t(stale ? 'productQuality.stale' : 'productQuality.delay') }}
    </p>
    <ErrorNotice v-if="error" :error="error" compact class="mt-3" />
    <h3 class="mt-3 text-sm font-medium">{{ t('productQuality.platform') }}</h3>
    <p v-if="!platform.length" class="mt-1 text-xs text-muted-foreground">
      {{ t('productQuality.noDetails') }}
    </p>
    <ul v-else class="mt-2 space-y-2 text-sm">
      <li v-for="issue in platform" :key="issue.id" class="space-y-1">
        <p>{{ issue.text }}</p>
        <Button
          v-if="productQualityFieldReferences(model, issue.text).length"
          variant="outline"
          size="sm"
          @click="emit('locate', productQualityFieldReferences(model, issue.text))"
          >{{ t('productQuality.locate') }}</Button
        >
        <p v-else class="text-xs text-muted-foreground">{{ t('productQuality.noTarget') }}</p>
      </li>
    </ul>
    <h3 class="mt-3 text-sm font-medium">{{ t('productQuality.local') }}</h3>
    <p v-if="!local.length" class="mt-1 text-xs text-muted-foreground">{{ t('productQuality.noLocal') }}</p>
    <ul v-else class="mt-2 space-y-2 text-sm">
      <li v-for="issue in local" :key="issue.code + issue.message">
        <button
          type="button"
          class="text-left underline-offset-4 hover:underline"
          @click="emit('locate', issue.fieldIds)"
        >
          {{ issue.message }}
        </button>
        <p class="text-xs text-muted-foreground">{{ issue.remediation }}</p>
      </li>
    </ul>
  </Card>
</template>
