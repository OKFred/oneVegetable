<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { ArrowDown, ArrowUp, Check, Trash2 } from '@lucide/vue';
import {
  composeDescriptionTemplates,
  DESCRIPTION_COMPOSITION_MAX_TEMPLATES,
  DESCRIPTION_VARIABLE_MAX_CHARACTERS,
  type DescriptionTemplateValues
} from '@one-vegetable/core/template-composition';
import type { ProductDescriptionTemplate } from '@one-vegetable/core';
import { sanitizeProductDescriptionHtml } from '@one-vegetable/core/browser';
import { useUiI18n } from '../i18n';
import { useTemplateCompositionI18n } from '../i18n/template-composition';
import SafeHtmlContent from './SafeHtmlContent.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';

type ApplyMode = 'insert' | 'append' | 'replace';
const props = defineProps<{
  templates: ProductDescriptionTemplate[];
  initialValues: DescriptionTemplateValues;
  currentHtml: string;
  mode: ApplyMode;
}>();
const emit = defineEmits<{
  'update:mode': [mode: ApplyMode];
  apply: [payload: { mode: ApplyMode; html: string }];
  back: [];
}>();
const { locale, t } = useUiI18n();
const tc = useTemplateCompositionI18n();
const id = useId();
const parts = ref([...props.templates]);
const values = ref<DescriptionTemplateValues>({ ...props.initialValues });
const initialValues = { ...props.initialValues };
const composition = computed(() => composeDescriptionTemplates(parts.value, values.value, locale.value));
const currentSafeHtml = computed(() => sanitizeProductDescriptionHtml(props.currentHtml, locale.value).html);
const confirmation = computed(() =>
  props.mode === 'replace'
    ? t('products.templates.confirmReplace')
    : tc(props.mode === 'insert' ? 'confirmInsert' : 'confirmAppend')
);

function move(index: number, offset: number): void {
  const target = index + offset;
  if (target < 0 || target >= parts.value.length) return;
  const result = [...parts.value];
  const part = result.splice(index, 1)[0];
  if (!part) return;
  result.splice(target, 0, part);
  parts.value = result;
}
function apply(): void {
  if (composition.value.canApply) emit('apply', { mode: props.mode, html: composition.value.html });
}
function changeMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'insert' || value === 'append' || value === 'replace') emit('update:mode', value);
}
</script>

<template>
  <div class="space-y-4" data-testid="description-template-composer">
    <div class="grid items-start gap-4 md:grid-cols-2">
      <div class="min-w-0 space-y-4">
        <section class="space-y-2 rounded-lg border p-3">
          <h3 class="text-sm font-medium">{{ tc('order') }}</h3>
          <ol class="space-y-2">
            <li v-for="(part, index) in parts" :key="part.id" class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm" :title="part.name"
                >{{ index + 1 }}. {{ part.name }}</span
              >
              <Button
                variant="ghost"
                size="icon"
                :disabled="index === 0"
                :aria-label="tc('moveUp', { name: part.name })"
                @click="move(index, -1)"
                ><ArrowUp class="size-4"
              /></Button>
              <Button
                variant="ghost"
                size="icon"
                :disabled="index === parts.length - 1"
                :aria-label="tc('moveDown', { name: part.name })"
                @click="move(index, 1)"
                ><ArrowDown class="size-4"
              /></Button>
              <Button
                variant="ghost"
                size="icon"
                :disabled="parts.length === 1"
                :aria-label="tc('remove', { name: part.name })"
                @click="parts = parts.filter((item) => item.id !== part.id)"
                ><Trash2 class="size-4"
              /></Button>
            </li>
          </ol>
        </section>
        <section v-if="composition.variables.length" class="space-y-3 rounded-lg border p-3">
          <h3 class="text-sm font-medium">{{ tc('values') }}</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <label
              v-for="variable in composition.variables"
              :key="variable"
              :for="`${id}-${variable}`"
              class="space-y-1 text-sm"
            >
              <span class="block">{{ tc(`variable_${variable}`) }}</span>
              <Input
                :id="`${id}-${variable}`"
                :model-value="values[variable] ?? ''"
                @update:model-value="values[variable] = $event"
                :maxlength="DESCRIPTION_VARIABLE_MAX_CHARACTERS * 2"
                :aria-invalid="composition.oversizedValues.includes(variable) || undefined"
              />
              <span class="block text-xs text-muted-foreground">{{
                initialValues[variable] && values[variable] === initialValues[variable]
                  ? tc('autofilled')
                  : tc('manual')
              }}</span>
            </label>
          </div>
        </section>
      </div>
      <div class="min-w-0 space-y-4">
        <div class="space-y-1 text-sm text-amber-800 dark:text-amber-200" aria-live="polite">
          <p v-if="composition.missing.length">{{ tc('missing', { count: composition.missing.length }) }}</p>
          <p v-if="composition.unsupported.length">
            {{ tc('unsupported', { names: composition.unsupported.join(', ') }) }}
          </p>
          <p v-if="composition.attributeVariables.length">
            {{ tc('attributes', { names: composition.attributeVariables.join(', ') }) }}
          </p>
          <p v-if="composition.oversizedValues.length">
            {{
              tc('oversizedValues', {
                count: DESCRIPTION_VARIABLE_MAX_CHARACTERS,
                names: composition.oversizedValues.map((variable) => tc(`variable_${variable}`)).join(', ')
              })
            }}
          </p>
          <p v-if="composition.tooLarge">{{ tc('tooLarge') }}</p>
          <p v-if="composition.tooMany">
            {{ tc('tooMany', { count: DESCRIPTION_COMPOSITION_MAX_TEMPLATES }) }}
          </p>
          <p v-if="composition.sanitizedChanges">
            {{ tc('sanitized', { count: composition.sanitizedChanges }) }}
          </p>
        </div>
        <label class="block text-sm font-medium"
          >{{ tc('mode') }}
          <select
            :value="mode"
            class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
            @change="changeMode"
          >
            <option value="insert">{{ t('products.templates.insert') }}</option>
            <option value="append">{{ t('products.templates.append') }}</option>
            <option value="replace">{{ t('products.templates.replace') }}</option>
          </select>
        </label>
        <div class="grid gap-4">
          <section v-if="mode === 'replace'" class="min-w-0 rounded-lg border p-3">
            <h3 class="mb-3 text-sm font-medium">{{ t('products.templates.current') }}</h3>
            <SafeHtmlContent :html="currentSafeHtml" class="max-h-72 overflow-auto text-sm" />
          </section>
          <section class="min-w-0 rounded-lg border border-primary/40 p-3">
            <h3 class="mb-3 text-sm font-medium">
              {{
                mode === 'replace'
                  ? t('products.templates.afterReplace', { name: parts.map((part) => part.name).join(' + ') })
                  : tc('preview')
              }}
            </h3>
            <SafeHtmlContent
              :html="composition.html"
              class="max-h-72 overflow-auto text-sm"
              data-testid="template-filled-preview"
            />
          </section>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" @click="emit('back')">{{ t('products.templates.back') }}</Button>
      <Button :disabled="!composition.canApply" @click="apply"
        ><Check class="size-4" />{{ confirmation }}</Button
      >
    </div>
  </div>
</template>
