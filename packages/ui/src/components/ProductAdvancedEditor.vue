<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { Save, Send } from '@lucide/vue';

import type {
  ProductDescriptionImageMetadata,
  ProductSchemaField,
  ProductSchemaFieldIssue,
  ProductSchemaModel,
  ProductSchemaSerializationInspection
} from '@one-vegetable/core';

import ProductEditorLoading from './ProductEditorLoading.vue';
import ProductSchemaFieldComponent from './ProductSchemaField.vue';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import { useUiI18n } from '../i18n';

const ProductSchemaXmlPreview = defineAsyncComponent({
  loader: () => import('./ProductSchemaXmlPreview.vue'),
  loadingComponent: ProductEditorLoading,
  delay: 100,
  timeout: 30_000
});

const props = withDefaults(
  defineProps<{
    model: ProductSchemaModel;
    issues: ProductSchemaFieldIssue[];
    productDescriptionType: string | undefined;
    language?: 'zh_CN' | 'en_US';
    submitPending: boolean;
    editing: boolean;
    publishDisabled: boolean;
    draftDisabled: boolean;
    platformDraftId: string | null;
    blockingCount: number;
    advisoryCount: number;
    schemaPreview: string;
    schemaInspection: ProductSchemaSerializationInspection;
  }>(),
  { language: 'en_US' }
);

const emit = defineEmits<{
  updateField: [sourceIndex: number, field: ProductSchemaField];
  imageStatus: [status: ProductDescriptionImageMetadata & { url: string }];
  submit: [draft: boolean];
}>();
const { t } = useUiI18n();

const xmlPreviewOpen = ref(false);
const serializationLabel = computed(() => {
  if (!props.schemaInspection.safe) return t('products.editor.serialization.invalid');
  return props.schemaInspection.noOp
    ? t('products.editor.serialization.unchanged')
    : t('products.editor.serialization.safePatch');
});
const changedFieldNames = computed(() =>
  props.schemaInspection.changedFieldKeys.map(
    (key) => props.model.fields.find((field) => field.key === key)?.name ?? key
  )
);

function handleXmlPreviewToggle(event: Event): void {
  if ((event.currentTarget as HTMLDetailsElement).open) xmlPreviewOpen.value = true;
}
</script>

<template>
  <div class="mt-5 space-y-4">
    <ProductSchemaFieldComponent
      v-for="(field, index) in model.fields"
      :key="field.key"
      :field="field"
      :issues="issues"
      :product-description-type="productDescriptionType"
      :language="language"
      @update="emit('updateField', index, $event)"
      @image-status="emit('imageStatus', $event)"
    />
  </div>
  <div v-if="model.warnings.length" class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
    <p class="font-medium">{{ t('products.editor.warnings') }}</p>
    <ul class="mt-1 list-disc pl-5">
      <li v-for="warning in model.warnings" :key="warning">{{ warning }}</li>
    </ul>
  </div>
  <details class="mt-5 rounded-lg border p-3" @toggle="handleXmlPreviewToggle">
    <summary class="flex cursor-pointer items-center gap-2 text-sm font-medium">
      {{ t('products.editor.xmlPreview') }}
      <Badge
        :variant="schemaInspection.safe ? (schemaInspection.noOp ? 'secondary' : 'success') : 'destructive'"
      >
        {{ serializationLabel }}
      </Badge>
    </summary>
    <ProductSchemaXmlPreview
      v-if="xmlPreviewOpen"
      :changed-field-names="changedFieldNames"
      :inspection="schemaInspection"
      :xml="schemaPreview"
    />
  </details>
  <div class="mt-5 flex flex-wrap gap-2">
    <Button
      :disabled="submitPending || publishDisabled || blockingCount > 0 || !schemaInspection.safe"
      @click="emit('submit', false)"
    >
      <Send class="size-4" />{{ t(editing ? 'products.editor.update' : 'products.editor.publish') }} ·
      {{ t('products.common.suggestionCount', { count: advisoryCount }) }}
    </Button>
    <Button
      v-if="!editing"
      variant="outline"
      :disabled="submitPending || draftDisabled || Boolean(platformDraftId) || !schemaInspection.safe"
      @click="emit('submit', true)"
    >
      <Save class="size-4" />{{ t('products.editor.savePlatformDraft') }}
    </Button>
  </div>
</template>
