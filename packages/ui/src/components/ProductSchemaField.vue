<script setup lang="ts">
defineOptions({ name: 'ProductSchemaField' });

import { computed, defineAsyncComponent } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';

import {
  cloneProductSchemaInstance,
  isProductSchemaFieldDisabled,
  isProductSchemaImageField,
  isProductSchemaFieldReadOnly,
  isProductSchemaHtmlField,
  productSchemaFieldText,
  productSchemaFieldTexts,
  type ProductSchemaField,
  type ProductSchemaFieldIssue,
  type Photo,
  withProductSchemaFieldText,
  withProductSchemaFieldTexts
} from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import PhotoBankPicker from './PhotoBankPicker.vue';

const ProductDescriptionEditor = defineAsyncComponent(() => import('./ProductDescriptionEditor.vue'));

const props = defineProps<{
  field: ProductSchemaField;
  issues: ProductSchemaFieldIssue[];
  productDescriptionType: string | undefined;
}>();
const emit = defineEmits<{ update: [field: ProductSchemaField] }>();

const fieldIssues = computed(() => props.issues.filter((issue) => issue.fieldKey === props.field.key));
const disabled = computed(() => isProductSchemaFieldDisabled(props.field));
const readOnly = computed(() => isProductSchemaFieldReadOnly(props.field));
const fieldText = computed(() => productSchemaFieldText(props.field));
const fieldTexts = computed(() => productSchemaFieldTexts(props.field));
const imageField = computed(() => isProductSchemaImageField(props.field));
const htmlField = computed(() => isProductSchemaHtmlField(props.field));
const imageLimit = computed(() => {
  const value = Number(
    props.field.rules.find((rule) => rule.name === 'maxInputNumRule')?.value ??
      (props.field.type === 'multiInput' ? 6 : 1)
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
});
const selectedPhotos = computed(() =>
  props.field.values
    .filter((value) => value.text && value.attributes.fileId)
    .map((value): Photo => ({
      id: value.attributes.fileId ?? '',
      name: value.attributes.fileName ?? value.text.split('/').at(-1) ?? '图片银行素材',
      url: value.text,
      groupId: value.attributes.groupId ?? '-1',
      width: positiveNumber(value.attributes.width),
      height: positiveNumber(value.attributes.height),
      fileSize: nonNegativeNumber(value.attributes.fileSize),
      referenceCount: nonNegativeNumber(value.attributes.referenceCount),
      modifiedAt: value.attributes.modifiedAt ?? new Date(0).toISOString()
    }))
);
const tip = computed(
  () => props.field.rules.find((rule) => rule.name === 'tipRule' || rule.name === 'devTipRule')?.value
);

function updateValue(value: string | string[]): void {
  emit(
    'update',
    Array.isArray(value)
      ? withProductSchemaFieldTexts(props.field, value)
      : withProductSchemaFieldText(props.field, value)
  );
}

function updateInstanceChild(instanceIndex: number, childIndex: number, child: ProductSchemaField): void {
  const instances = props.field.instances.map((instance, currentInstanceIndex) =>
    currentInstanceIndex === instanceIndex
      ? instance.map((value, currentChildIndex) => (currentChildIndex === childIndex ? child : value))
      : instance
  );
  emit('update', { ...props.field, instances });
}

function updateComplexChild(index: number, child: ProductSchemaField): void {
  const firstInstance = props.field.instances[0];
  if (firstInstance) {
    updateInstanceChild(0, index, child);
    return;
  }
  const children = props.field.children.map((value, childIndex) => (childIndex === index ? child : value));
  emit('update', { ...props.field, children });
}

function toggleOption(value: string, checked: boolean): void {
  const current = fieldTexts.value;
  updateValue(checked ? [...new Set([...current, value])] : current.filter((item) => item !== value));
}

function updatePhotos(photos: Photo[]): void {
  emit('update', {
    ...props.field,
    values: photos.map((photo) => ({
      text: photo.url,
      attributes: {
        fileId: photo.id,
        fileName: photo.name,
        groupId: photo.groupId,
        width: String(photo.width),
        height: String(photo.height),
        fileSize: String(photo.fileSize),
        referenceCount: String(photo.referenceCount),
        modifiedAt: photo.modifiedAt
      }
    }))
  });
}

function positiveNumber(value: string | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function nonNegativeNumber(value: string | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function addInstance(): void {
  emit('update', {
    ...props.field,
    instances: [...props.field.instances, cloneProductSchemaInstance(props.field)]
  });
}

function removeInstance(index: number): void {
  emit('update', {
    ...props.field,
    instances: props.field.instances.filter((_, currentIndex) => currentIndex !== index)
  });
}
</script>

<template>
  <div v-if="field.type === 'label'" class="rounded-lg border bg-muted/50 p-3 text-sm">
    <p class="font-medium">{{ field.name }}</p>
    <p class="mt-1 text-muted-foreground">
      {{ fieldTexts.join('；') }}
    </p>
  </div>

  <fieldset v-else class="space-y-2 rounded-lg border p-4" :disabled="readOnly">
    <div class="flex flex-wrap items-center gap-2">
      <legend class="text-sm font-medium">{{ field.name }}</legend>
      <Badge variant="outline">{{ field.type }}</Badge>
      <Badge v-if="readOnly" variant="secondary">只读</Badge>
      <Badge v-if="disabled" variant="secondary">已禁用</Badge>
    </div>
    <p v-if="tip" class="text-xs text-muted-foreground">{{ tip }}</p>

    <ProductDescriptionEditor
      v-if="htmlField"
      :model-value="fieldText"
      :smart-detail="productDescriptionType !== undefined && productDescriptionType !== '2'"
      @update:model-value="updateValue"
    />
    <PhotoBankPicker
      v-else-if="imageField && (field.type === 'input' || field.type === 'multiInput')"
      :model-value="selectedPhotos"
      :max="imageLimit"
      @update:model-value="updatePhotos"
    />
    <Input
      v-else-if="field.type === 'input'"
      :model-value="fieldText"
      :aria-label="field.name"
      @update:model-value="updateValue"
    />
    <textarea
      v-else-if="field.type === 'multiInput'"
      :value="fieldTexts.join('\n')"
      :aria-label="field.name"
      class="min-h-24 w-full rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      @input="updateValue(($event.target as HTMLTextAreaElement).value.split('\n'))"
    />
    <div v-else-if="field.type === 'singleCheck'" class="flex flex-wrap gap-3">
      <label v-for="option in field.options" :key="option.value" class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          :name="field.key"
          :value="option.value"
          :checked="fieldText === option.value"
          @change="updateValue(option.value)"
        />{{ option.label }}
      </label>
    </div>
    <div v-else-if="field.type === 'multiCheck'" class="flex flex-wrap gap-3">
      <label v-for="option in field.options" :key="option.value" class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          :value="option.value"
          :checked="fieldTexts.includes(option.value)"
          @change="toggleOption(option.value, ($event.target as HTMLInputElement).checked)"
        />{{ option.label }}
      </label>
    </div>
    <div v-else-if="field.type === 'complex'" class="space-y-3 border-l-2 pl-3">
      <ProductSchemaField
        v-for="(child, index) in field.instances[0] ?? field.children"
        :key="child.key"
        :field="child"
        :issues="issues"
        :product-description-type="productDescriptionType"
        @update="updateComplexChild(index, $event)"
      />
    </div>
    <div v-else-if="field.type === 'multiComplex'" class="space-y-3">
      <div
        v-for="(instance, instanceIndex) in field.instances"
        :key="`${field.key}:${instanceIndex}`"
        class="space-y-3 rounded-lg bg-muted/40 p-3"
      >
        <div class="flex justify-between text-xs font-medium text-muted-foreground">
          <span>{{ field.name }} #{{ instanceIndex + 1 }}</span>
          <Button variant="ghost" size="sm" @click="removeInstance(instanceIndex)">
            <Trash2 class="size-3" />删除
          </Button>
        </div>
        <ProductSchemaField
          v-for="(child, childIndex) in instance"
          :key="child.key"
          :field="child"
          :issues="issues"
          :product-description-type="productDescriptionType"
          @update="updateInstanceChild(instanceIndex, childIndex, $event)"
        />
      </div>
      <Button variant="outline" size="sm" @click="addInstance">
        <Plus class="size-3" />新增 {{ field.name }}
      </Button>
    </div>

    <ul v-if="fieldIssues.length" class="space-y-1 text-xs">
      <li
        v-for="issue in fieldIssues"
        :key="`${issue.rule}:${issue.message}`"
        :class="issue.severity === 'error' ? 'text-destructive' : 'text-amber-700'"
      >
        {{ issue.message }}
      </li>
    </ul>
  </fieldset>
</template>
