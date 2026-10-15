import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue';
import {
  descriptionTemplateValuesFromSchema,
  type DescriptionTemplateValues
} from '@one-vegetable/core/template-composition';
import type { ProductSchemaModel } from '@one-vegetable/core';

const contextKey: InjectionKey<ComputedRef<DescriptionTemplateValues>> = Symbol(
  'description-template-values'
);
export function provideDescriptionTemplateContext(model: () => ProductSchemaModel): void {
  provide(
    contextKey,
    computed(() => descriptionTemplateValuesFromSchema(model()))
  );
}
export function useDescriptionTemplateContext(): ComputedRef<DescriptionTemplateValues> {
  return inject(
    contextKey,
    computed(() => ({}))
  );
}
