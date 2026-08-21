<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, Gauge, ListChecks } from '@lucide/vue';

import {
  productEditorStepForField,
  selectQuickPublishFields,
  type ProductDescriptionImageMetadata,
  type ProductDescriptionQualityIssue,
  type ProductEditorFieldEntry,
  type ProductEditorStepId,
  type ProductSchemaField,
  type ProductSchemaFieldIssue,
  type ProductSchemaModel,
  type ProductSchemaSerializationInspection
} from '@one-vegetable/core';

import ProductEditorSubmitBar from './ProductEditorSubmitBar.vue';
import ProductFieldsPanel from './ProductFieldsPanel.vue';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';

const props = defineProps<{
  model: ProductSchemaModel;
  issues: ProductSchemaFieldIssue[];
  qualityIssues: ProductDescriptionQualityIssue[];
  productDescriptionType: string | undefined;
  submitPending: boolean;
  schemaInspection: ProductSchemaSerializationInspection;
  publishDisabled: boolean;
  draftDisabled: boolean;
  publishDisabledReason: string;
  draftDisabledReason: string;
  platformDraftId: string | null;
}>();

const emit = defineEmits<{
  updateField: [sourceIndex: number, field: ProductSchemaField];
  imageStatus: [status: ProductDescriptionImageMetadata & { url: string }];
  submit: [draft: boolean];
  openFull: [];
}>();

const moreOpen = ref(false);
const selection = computed(() => selectQuickPublishFields(props.model.fields));
const blockingCount = computed(() => props.issues.filter((issue) => issue.severity === 'error').length);
const advisoryCount = computed(
  () =>
    props.qualityIssues.filter((issue) => issue.source !== 'alibaba-schema' || issue.level !== 'error').length
);
const groups = computed(() => groupEntries(selection.value.essential));
const moreGroups = computed(() => groupEntries(selection.value.remaining));

const SECTION_LABELS: Record<ProductEditorStepId, string> = {
  basics: '基础信息与分组',
  attributes: '必填商品属性',
  media: '商品图片',
  description: '商品详情',
  trade: '交易与物流',
  review: '检查与提交'
};

function groupEntries(entries: ProductEditorFieldEntry[]) {
  const grouped = new Map<ProductEditorStepId, ProductEditorFieldEntry[]>();
  for (const entry of entries) {
    const step = productEditorStepForField(entry.field);
    const values = grouped.get(step) ?? [];
    values.push(entry);
    grouped.set(step, values);
  }
  return [...grouped.entries()].map(([id, values]) => ({ id, label: SECTION_LABELS[id], entries: values }));
}
</script>

<template>
  <div class="mt-5">
    <div class="rounded-lg border border-primary/25 bg-primary/5 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="flex items-center gap-2 font-medium"><Gauge class="size-4 text-primary" />最快发品路径</p>
          <p class="mt-1 text-sm text-muted-foreground">
            先填写必填项和常用信息，优先保存为平台草稿；其余内容可稍后增量完善。
          </p>
        </div>
        <Badge variant="secondary">{{ selection.essential.length }} 个优先字段</Badge>
      </div>
    </div>

    <div class="mt-5 space-y-6">
      <section v-for="group in groups" :key="group.id" class="space-y-3">
        <div class="flex items-center gap-2 border-b pb-2">
          <h3 class="font-semibold">{{ group.label }}</h3>
          <Badge variant="outline">{{ group.entries.length }}</Badge>
        </div>
        <ProductFieldsPanel
          :entries="group.entries"
          :issues="issues"
          :product-description-type="productDescriptionType"
          @update-field="(index, field) => emit('updateField', index, field)"
          @image-status="emit('imageStatus', $event)"
        />
      </section>
    </div>

    <section v-if="selection.remaining.length" class="mt-6 rounded-lg border">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 p-4 text-left"
        :aria-expanded="moreOpen"
        @click="moreOpen = !moreOpen"
      >
        <span>
          <span class="flex items-center gap-2 font-medium"><ListChecks class="size-4" />继续完善</span>
          <span class="mt-1 block text-xs text-muted-foreground">
            {{ selection.remaining.length }} 个非核心字段，可现在填写或保存草稿后再处理。
          </span>
        </span>
        <ChevronDown class="size-4 transition-transform" :class="moreOpen ? 'rotate-180' : ''" />
      </button>
      <Transition name="ov-collapse">
        <div v-if="moreOpen" class="space-y-6 border-t p-4">
          <section v-for="group in moreGroups" :key="group.id" class="space-y-3">
            <h3 class="text-sm font-semibold">{{ group.label }}</h3>
            <ProductFieldsPanel
              :entries="group.entries"
              :issues="issues"
              :product-description-type="productDescriptionType"
              @update-field="(index, field) => emit('updateField', index, field)"
              @image-status="emit('imageStatus', $event)"
            />
          </section>
        </div>
      </Transition>
    </section>

    <div class="mt-4 flex justify-end">
      <Button variant="ghost" size="sm" @click="emit('openFull')">切换到六步向导检查全部字段</Button>
    </div>

    <ProductEditorSubmitBar
      quick
      :editing="false"
      :submit-pending="submitPending"
      :schema-safe="schemaInspection.safe"
      :blocking-count="blockingCount"
      :advisory-count="advisoryCount"
      :publish-disabled="publishDisabled"
      :draft-disabled="draftDisabled"
      :publish-disabled-reason="publishDisabledReason"
      :draft-disabled-reason="draftDisabledReason"
      :platform-draft-id="platformDraftId"
      @submit="emit('submit', $event)"
    />
  </div>
</template>
