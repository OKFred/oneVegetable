import { computed, ref } from 'vue';

import {
  inspectProductSchemaSerialization,
  markProductSchemaFieldTouched,
  productSchemaFieldText,
  validateProductSchemaModel,
  withProductSchemaFieldText
} from '@one-vegetable/core';

import type {
  AlibabaLanguage,
  ProductEditorStepId,
  ProductSchemaField,
  ProductSchemaModel,
  ProductSchemaSerializationInspection
} from '@one-vegetable/core';
import type { ProductEditorMode } from '../lib/product-editor-drafts';

export interface ProductEditorSessionOptions {
  language: AlibabaLanguage;
  onFieldChange?: () => void;
}

export function useProductEditorSession(options: ProductEditorSessionOptions) {
  const model = ref<ProductSchemaModel | null>(null);
  const categoryId = ref('');
  const language = ref<AlibabaLanguage>(options.language);
  const market = ref<'wholesale' | 'sourcing'>('wholesale');
  const productId = ref('');
  const platformDraftId = ref<string | null>(null);
  const mode = ref<ProductEditorMode>('quick');
  const step = ref<ProductEditorStepId>('basics');

  const issues = computed(() => (model.value ? validateProductSchemaModel(model.value) : []));
  const blockingIssues = computed(() => issues.value.filter((issue) => issue.severity === 'error'));
  const inspection = computed<ProductSchemaSerializationInspection>(() => {
    if (!model.value) {
      return { xml: '', noOp: true, changedFieldKeys: [], structuralDiffs: [], safe: true };
    }
    try {
      return inspectProductSchemaSerialization(model.value);
    } catch (error: unknown) {
      return {
        xml: model.value.sourceXml,
        noOp: false,
        changedFieldKeys: [],
        structuralDiffs: [error instanceof Error ? error.message : 'Schema XML 序列化失败'],
        safe: false
      };
    }
  });
  const preview = computed(() => inspection.value.xml);
  const descriptionType = computed(() => {
    const field = model.value?.fields.find((candidate) => candidate.id === 'productDescType');
    return field ? productSchemaFieldText(field) : undefined;
  });
  const descriptionHtml = computed(() => {
    const field = model.value?.fields.find(
      (candidate) =>
        candidate.id === 'superText' ||
        candidate.rules.some(
          (rule) => rule.name === 'valueTypeRule' && rule.value.toLocaleLowerCase() === 'html'
        )
    );
    return field ? productSchemaFieldText(field) : '';
  });

  function updateRootField(index: number, field: ProductSchemaField): void {
    if (!model.value) return;
    const isDescription =
      field.id === 'superText' ||
      field.rules.some((rule) => rule.name === 'valueTypeRule' && rule.value.toLocaleLowerCase() === 'html');
    let nextModel: ProductSchemaModel = {
      ...model.value,
      fields: model.value.fields.map((current, currentIndex) => {
        if (currentIndex === index) return field;
        if (isDescription && current.id === 'productDescType') {
          return withProductSchemaFieldText(current, '2');
        }
        return current;
      })
    };
    nextModel = markProductSchemaFieldTouched(nextModel, field.key);
    if (isDescription) {
      const typeField = nextModel.fields.find((current) => current.id === 'productDescType');
      if (typeField) nextModel = markProductSchemaFieldTouched(nextModel, typeField.key);
    }
    model.value = nextModel;
    options.onFieldChange?.();
  }

  function reset(input: { productId?: string; categoryId?: string; mode: ProductEditorMode }): void {
    model.value = null;
    productId.value = input.productId ?? '';
    if (input.categoryId !== undefined) categoryId.value = input.categoryId;
    platformDraftId.value = null;
    mode.value = input.mode;
    step.value = 'basics';
  }

  return {
    model,
    categoryId,
    language,
    market,
    productId,
    platformDraftId,
    mode,
    step,
    issues,
    blockingIssues,
    inspection,
    preview,
    descriptionType,
    descriptionHtml,
    updateRootField,
    reset
  };
}
