<script setup lang="ts">
defineOptions({ name: 'ProductSchemaField' });

import { computed, defineAsyncComponent, ref } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';

import {
  cloneProductSchemaInstance,
  collectProductSchemaOfficialHints,
  isProductSchemaFieldDisabled,
  isProductSchemaImageField,
  isProductSchemaFieldReadOnly,
  isProductSchemaHtmlField,
  isProductEditorFieldRequired,
  isProductSchemaGroupField,
  productEditorFieldDomId,
  productSchemaFieldText,
  productSchemaFieldTexts,
  type ProductSchemaField,
  type ProductSchemaFieldIssue,
  type Photo,
  type ProductDescriptionImageMetadata,
  withProductSchemaFieldText
} from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import OfficialHintContent from './OfficialHintContent.vue';
import PhotoBankPicker from './PhotoBankPicker.vue';
import ProductGroupPicker from './ProductGroupPicker.vue';

const ProductDescriptionEditor = defineAsyncComponent(() => import('./ProductDescriptionEditor.vue'));

const props = withDefaults(
  defineProps<{
    field: ProductSchemaField;
    issues: ProductSchemaFieldIssue[];
    productDescriptionType: string | undefined;
    showTechnical?: boolean;
    labelOverride?: string;
  }>(),
  { showTechnical: true, labelOverride: '' }
);
const emit = defineEmits<{
  update: [field: ProductSchemaField];
  imageStatus: [status: ProductDescriptionImageMetadata & { url: string }];
}>();

const fieldIssues = computed(() => props.issues.filter((issue) => issue.fieldKey === props.field.key));
const displayName = computed(() => props.labelOverride || props.field.name);
const disabled = computed(() => isProductSchemaFieldDisabled(props.field));
const readOnly = computed(() => isProductSchemaFieldReadOnly(props.field));
const fieldText = computed(() => productSchemaFieldText(props.field));
const fieldTexts = computed(() => productSchemaFieldTexts(props.field));
const imageField = computed(() => isProductSchemaImageField(props.field));
const htmlField = computed(() => isProductSchemaHtmlField(props.field));
const groupField = computed(() => isProductSchemaGroupField(props.field));
const required = computed(() => isProductEditorFieldRequired(props.field));
const minimumItems = computed(() => itemRuleLimit('minInputNumRule', 0));
const maximumItems = computed(() => itemRuleLimit('maxInputNumRule', Number.POSITIVE_INFINITY));
const repeatableComplex = computed(
  () =>
    props.field.type === 'multiComplex' ||
    (props.field.type === 'complex' &&
      props.field.rules.some((rule) => rule.name === 'minInputNumRule' || rule.name === 'maxInputNumRule'))
);
const keywordComplex = computed(
  () => props.field.type === 'complex' && /keyword|关键词/i.test(`${props.field.id} ${props.field.name}`)
);
const unmatchedOptionValues = computed(() =>
  props.field.values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => !props.field.options.some((option) => option.value === value.text))
);
const manualOptionValue = ref('');
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
      name: value.metadata.fileName ?? value.text.split('/').at(-1) ?? '图库素材',
      url: value.text,
      groupId: value.metadata.groupId ?? '-1',
      width: positiveNumberOrNull(value.metadata.width),
      height: positiveNumberOrNull(value.metadata.height),
      fileSize: nonNegativeNumber(value.metadata.fileSize),
      referenceCount: nonNegativeNumber(value.metadata.referenceCount),
      modifiedAt: value.metadata.modifiedAt ?? new Date(0).toISOString()
    }))
);
const officialHints = computed(() => collectProductSchemaOfficialHints([props.field], { recursive: false }));

function updateValue(value: string): void {
  emit('update', withProductSchemaFieldText(props.field, value));
}

function itemRuleLimit(name: 'minInputNumRule' | 'maxInputNumRule', fallback: number): number {
  const value = Number(props.field.rules.find((rule) => rule.name === name)?.value);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function updateMultiValue(index: number, text: string): void {
  emit('update', {
    ...props.field,
    values: props.field.values.map((value, currentIndex) =>
      currentIndex === index ? { ...value, text } : value
    )
  });
}

function addMultiValue(): void {
  if (props.field.values.length >= maximumItems.value) return;
  emit('update', {
    ...props.field,
    values: [...props.field.values, { text: '', attributes: {}, metadata: {} }]
  });
}

function removeMultiValue(index: number): void {
  if (props.field.values.length <= minimumItems.value) return;
  emit('update', {
    ...props.field,
    values: props.field.values.filter((_, currentIndex) => currentIndex !== index)
  });
}

function updateInstanceChild(instanceIndex: number, childIndex: number, child: ProductSchemaField): void {
  const instances = props.field.instances.map((instance, currentInstanceIndex) =>
    currentInstanceIndex === instanceIndex
      ? {
          ...instance,
          fields: instance.fields.map((value, currentChildIndex) =>
            currentChildIndex === childIndex ? child : value
          )
        }
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
  const fields = props.field.children.map((value, childIndex) => (childIndex === index ? child : value));
  emit('update', {
    ...props.field,
    instances: [
      {
        key: `${props.field.key}:instance:new:0`,
        sourcePath: null,
        sourceIndex: null,
        fields
      }
    ]
  });
}

function toggleOption(value: string, checked: boolean): void {
  if (checked && !fieldTexts.value.includes(value)) {
    emit('update', {
      ...props.field,
      values: [...props.field.values, { text: value, attributes: {}, metadata: {} }]
    });
    return;
  }
  if (!checked) {
    emit('update', {
      ...props.field,
      values: props.field.values.filter((item) => item.text !== value)
    });
  }
}

function addManualOption(): void {
  const value = manualOptionValue.value.trim();
  if (!value || fieldTexts.value.includes(value) || props.field.values.length >= maximumItems.value) return;
  emit('update', {
    ...props.field,
    values: [...props.field.values, { text: value, attributes: {}, metadata: {} }]
  });
  manualOptionValue.value = '';
}

function updatePhotos(photos: Photo[]): void {
  emit('update', {
    ...props.field,
    values: photos.map((photo) => ({
      text: photo.url,
      attributes: {
        fileId: photo.id
      },
      metadata: {
        fileName: photo.name,
        groupId: photo.groupId,
        ...(photo.width === null ? {} : { width: String(photo.width) }),
        ...(photo.height === null ? {} : { height: String(photo.height) }),
        fileSize: String(photo.fileSize),
        referenceCount: String(photo.referenceCount),
        modifiedAt: photo.modifiedAt
      }
    }))
  });
}

function positiveNumberOrNull(value: string | undefined): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value: string | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function addInstance(): void {
  if (props.field.instances.length >= maximumItems.value) return;
  emit('update', {
    ...props.field,
    instances: [...props.field.instances, cloneProductSchemaInstance(props.field)]
  });
}

function removeInstance(index: number): void {
  if (props.field.instances.length <= minimumItems.value) return;
  emit('update', {
    ...props.field,
    instances: props.field.instances.filter((_, currentIndex) => currentIndex !== index)
  });
}
</script>

<template>
  <div
    v-if="field.type === 'label'"
    :id="productEditorFieldDomId(field.key)"
    :data-field-key="field.key"
    class="rounded-lg border bg-muted/50 p-3 text-sm"
  >
    <p class="font-medium">{{ field.name }}</p>
    <p class="mt-1 text-muted-foreground">
      {{ fieldTexts.join('；') }}
    </p>
  </div>

  <fieldset
    v-else
    :id="productEditorFieldDomId(field.key)"
    :data-field-key="field.key"
    class="space-y-2 rounded-lg border p-4"
    :disabled="readOnly"
  >
    <div class="flex flex-wrap items-center gap-2">
      <legend class="text-sm font-medium">{{ displayName }}</legend>
      <Badge v-if="required" variant="warning">必填</Badge>
      <Badge v-if="showTechnical" variant="outline">{{ field.type }}</Badge>
      <Badge v-if="readOnly" variant="secondary">只读</Badge>
      <Badge v-if="disabled" variant="secondary">已禁用</Badge>
    </div>
    <div v-if="officialHints.length" class="space-y-2">
      <OfficialHintContent
        v-for="hint in officialHints"
        :key="hint.id"
        :hint="hint"
        compact
        :show-locate="false"
      />
    </div>

    <ProductGroupPicker
      v-if="groupField"
      :field="field"
      :show-technical="showTechnical"
      @update="emit('update', $event)"
    />
    <ProductDescriptionEditor
      v-else-if="htmlField"
      :model-value="fieldText"
      :smart-detail="productDescriptionType !== undefined && productDescriptionType !== '2'"
      @update:model-value="updateValue"
      @image-status="emit('imageStatus', $event)"
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
      :aria-label="displayName"
      @update:model-value="updateValue"
    />
    <div v-else-if="field.type === 'multiInput'" class="space-y-2">
      <div v-for="(value, index) in field.values" :key="`${field.key}:value:${index}`" class="flex gap-2">
        <Input
          :model-value="value.text"
          :aria-label="`${displayName} 第 ${index + 1} 项`"
          :placeholder="`${displayName} 第 ${index + 1} 项`"
          @update:model-value="updateMultiValue(index, $event)"
        />
        <Button
          variant="ghost"
          size="icon"
          :aria-label="`删除 ${displayName} 第 ${index + 1} 项`"
          :disabled="field.values.length <= minimumItems"
          @click="removeMultiValue(index)"
        >
          <Trash2 class="size-4" />
        </Button>
      </div>
      <p v-if="field.values.length === 0" class="text-xs text-muted-foreground">尚未填写任何项目。</p>
      <Button
        variant="outline"
        size="sm"
        :disabled="field.values.length >= maximumItems"
        @click="addMultiValue"
      >
        <Plus class="size-3" />新增 {{ displayName }}
      </Button>
      <p
        v-if="field.rules.some((rule) => rule.name === 'valueAttributeRule')"
        class="text-xs text-amber-700 dark:text-amber-400"
      >
        该字段包含 Alibaba 值属性规则；已有值会保留属性，新项目仍需由提交接口校验。
      </p>
    </div>
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
    <div v-else-if="field.type === 'multiCheck'" class="space-y-3">
      <div v-if="field.options.length" class="flex flex-wrap gap-3">
        <label v-for="option in field.options" :key="option.value" class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            :value="option.value"
            :checked="fieldTexts.includes(option.value)"
            @change="toggleOption(option.value, ($event.target as HTMLInputElement).checked)"
          />{{ option.label }}
        </label>
      </div>
      <div v-if="unmatchedOptionValues.length" class="space-y-2">
        <p class="text-xs text-muted-foreground">Schema 未提供以下已选值的显示名称：</p>
        <div
          v-for="entry in unmatchedOptionValues"
          :key="`${field.key}:fallback:${entry.index}`"
          class="flex gap-2"
        >
          <Input
            :model-value="entry.value.text"
            :aria-label="`${displayName} 已选值 ${entry.index + 1}`"
            @update:model-value="updateMultiValue(entry.index, $event)"
          />
          <Button
            variant="ghost"
            size="icon"
            :aria-label="`删除 ${displayName} 已选值 ${entry.index + 1}`"
            :disabled="field.values.length <= minimumItems"
            @click="removeMultiValue(entry.index)"
          >
            <Trash2 class="size-4" />
          </Button>
        </div>
      </div>
      <div v-if="field.options.length === 0" class="space-y-2">
        <p class="text-xs text-amber-700 dark:text-amber-400">
          Alibaba Schema 未返回候选项；这里维护原始值，提交前仍由平台校验。
        </p>
        <div class="flex gap-2">
          <Input
            v-model="manualOptionValue"
            :aria-label="`新增 ${displayName} 原始值`"
            placeholder="输入 Schema 原始值"
            @keydown.enter.prevent="addManualOption"
          />
          <Button
            variant="outline"
            :disabled="!manualOptionValue.trim() || field.values.length >= maximumItems"
            @click="addManualOption"
          >
            <Plus class="size-3" />新增
          </Button>
        </div>
      </div>
    </div>
    <div v-else-if="field.type === 'complex' && !repeatableComplex" class="space-y-3 border-l-2 pl-3">
      <ProductSchemaField
        v-for="(child, index) in field.instances[0]?.fields ?? field.children"
        :key="child.key"
        :field="child"
        :issues="issues"
        :product-description-type="productDescriptionType"
        :show-technical="showTechnical"
        @update="updateComplexChild(index, $event)"
        @image-status="emit('imageStatus', $event)"
      />
    </div>
    <div v-else-if="repeatableComplex" class="space-y-3">
      <div
        v-for="(instance, instanceIndex) in field.instances"
        :key="instance.key"
        class="space-y-3 rounded-lg bg-muted/40 p-3"
      >
        <div class="flex justify-between text-xs font-medium text-muted-foreground">
          <span>{{ displayName }} #{{ instanceIndex + 1 }}</span>
          <Button
            variant="ghost"
            size="sm"
            :disabled="field.instances.length <= minimumItems"
            @click="removeInstance(instanceIndex)"
          >
            <Trash2 class="size-3" />删除
          </Button>
        </div>
        <ProductSchemaField
          v-for="(child, childIndex) in instance.fields"
          :key="child.key"
          :field="child"
          :issues="issues"
          :product-description-type="productDescriptionType"
          :show-technical="showTechnical"
          v-bind="keywordComplex ? { labelOverride: `关键词 ${instanceIndex + 1}` } : {}"
          @update="updateInstanceChild(instanceIndex, childIndex, $event)"
          @image-status="emit('imageStatus', $event)"
        />
      </div>
      <p v-if="field.instances.length === 0" class="text-xs text-muted-foreground">尚未填写任何项目。</p>
      <Button
        variant="outline"
        size="sm"
        :disabled="field.instances.length >= maximumItems"
        @click="addInstance"
      >
        <Plus class="size-3" />新增 {{ keywordComplex ? '关键词' : displayName }}
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
