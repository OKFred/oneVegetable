<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ChevronLeft, ChevronRight, RefreshCw, Save, Search, Send, ShieldAlert } from '@lucide/vue';

import {
  classifyProductSchemaFields,
  productEditorFieldDomId,
  type ProductDescriptionImageMetadata,
  type ProductDescriptionQualityIssue,
  type ProductEditorStepId,
  type ProductSchemaField,
  type ProductSchemaFieldIssue,
  type ProductSchemaModel,
  type ProductSchemaOfficialHint,
  type ProductSchemaSerializationInspection
} from '@one-vegetable/core';

import OfficialHintContent from './OfficialHintContent.vue';
import PlatformDraftHandoff from './PlatformDraftHandoff.vue';
import ProductQuickEditor from './ProductQuickEditor.vue';
import ProductSchemaFieldComponent from './ProductSchemaField.vue';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';

type ProductEditorMode = 'quick' | 'guided' | 'advanced';

const props = withDefaults(
  defineProps<{
    model: ProductSchemaModel;
    issues: ProductSchemaFieldIssue[];
    qualityIssues: ProductDescriptionQualityIssue[];
    officialHints: ProductSchemaOfficialHint[];
    productDescriptionType: string | undefined;
    language?: 'zh_CN' | 'en_US';
    mode: ProductEditorMode;
    step: ProductEditorStepId;
    mutationDisabled?: boolean;
    publishDisabled?: boolean;
    draftDisabled?: boolean;
    publishDisabledReason?: string;
    draftDisabledReason?: string;
    platformDraftId?: string | null;
    submitPending: boolean;
    editing: boolean;
    scoreAvailable: boolean;
    scorePending: boolean;
    scoreError: string | undefined;
    schemaPreview: string;
    schemaInspection: ProductSchemaSerializationInspection;
  }>(),
  {
    mutationDisabled: false,
    language: 'en_US',
    publishDisabledReason: '',
    draftDisabledReason: '',
    platformDraftId: null
  }
);

const emit = defineEmits<{
  'update:mode': [mode: ProductEditorMode];
  'update:step': [step: ProductEditorStepId];
  updateField: [sourceIndex: number, field: ProductSchemaField];
  imageStatus: [status: ProductDescriptionImageMetadata & { url: string }];
  refreshScore: [];
  submit: [draft: boolean];
}>();

const search = ref('');
const optionalOpen = ref<Record<string, boolean>>({});
const sections = computed(() => classifyProductSchemaFields(props.model.fields));
const currentSection = computed(
  () => sections.value.find((section) => section.id === props.step) ?? sections.value[0]
);
const currentStepIndex = computed(() => sections.value.findIndex((section) => section.id === props.step));
const blockingIssues = computed(() => {
  const issues = props.issues.filter((issue) => issue.severity === 'error');
  if (!props.editing) return issues;
  const changedFieldKeys = props.schemaInspection.changedFieldKeys;
  return issues.filter((issue) =>
    changedFieldKeys.some(
      (fieldKey) => issue.fieldKey === fieldKey || issue.fieldKey.startsWith(`${fieldKey}:`)
    )
  );
});
const resolvedPublishDisabled = computed(() => props.publishDisabled || props.mutationDisabled);
const resolvedDraftDisabled = computed(() => props.draftDisabled || props.mutationDisabled);
const advisoryIssues = computed(() =>
  props.qualityIssues.filter((issue) => issue.source !== 'alibaba-schema' || issue.level !== 'error')
);
const requiredEntries = computed(() =>
  sections.value.flatMap((section) => section.fields).filter((entry) => entry.required)
);
const completedRequiredCount = computed(
  () => requiredEntries.value.filter((entry) => !hasRequiredIssue(entry.field)).length
);
const visibleEntries = computed(() => {
  const section = currentSection.value;
  if (!section) return [];
  const query = search.value.trim().toLocaleLowerCase();
  return section.fields.filter((entry) => {
    if (query) return `${entry.field.name} ${entry.field.id}`.toLocaleLowerCase().includes(query);
    return !entry.optional || optionalOpen.value[section.id] === true;
  });
});
const hiddenOptionalCount = computed(
  () => currentSection.value?.fields.filter((entry) => entry.optional).length ?? 0
);
const issuesBySource = computed(() => ({
  'alibaba-schema': props.qualityIssues.filter((issue) => issue.source === 'alibaba-schema'),
  project: props.qualityIssues.filter((issue) => issue.source === 'project')
}));
const officialHintGroups = computed(() => {
  const groups = new Map<
    string,
    {
      id: string;
      label: string;
      hints: ProductSchemaOfficialHint[];
      fieldKeys: Set<string>;
    }
  >();
  for (const hint of props.officialHints) {
    const id = hint.rootFieldKey ?? `${hint.source}:${hint.rootFieldName}`;
    const existing = groups.get(id);
    if (existing) {
      existing.hints.push(hint);
      for (const fieldKey of hint.fieldKeys) existing.fieldKeys.add(fieldKey);
      continue;
    }
    groups.set(id, {
      id,
      label: hint.rootFieldName,
      hints: [hint],
      fieldKeys: new Set(hint.fieldKeys)
    });
  }
  return [...groups.values()].map((group) => ({
    id: group.id,
    label: group.label,
    hints: group.hints,
    fieldCount: group.fieldKeys.size
  }));
});
const serializationLabel = computed(() => {
  if (!props.schemaInspection.safe) return '结构异常';
  return props.schemaInspection.noOp ? '原样' : '安全补丁';
});
const changedFieldNames = computed(() =>
  props.schemaInspection.changedFieldKeys.map(
    (key) => props.model.fields.find((field) => field.key === key)?.name ?? key
  )
);

function sectionIssueCount(sectionId: ProductEditorStepId): number {
  if (sectionId === 'review') return blockingIssues.value.length;
  const section = sections.value.find((candidate) => candidate.id === sectionId);
  if (!section) return 0;
  const keys = new Set(section.fields.flatMap((entry) => collectFieldReferences(entry.field)));
  return props.issues.filter((issue) => issue.severity === 'error' && keys.has(issue.fieldKey)).length;
}

function hasRequiredIssue(field: ProductSchemaField): boolean {
  const keys = new Set(collectFieldReferences(field));
  return props.issues.some(
    (issue) => issue.severity === 'error' && issue.rule === 'requiredRule' && keys.has(issue.fieldKey)
  );
}

function collectFieldReferences(field: ProductSchemaField): string[] {
  const values = [field.key, field.id];
  for (const child of field.children) values.push(...collectFieldReferences(child));
  for (const instance of field.instances) {
    for (const child of instance.fields) values.push(...collectFieldReferences(child));
  }
  return values;
}

function moveStep(offset: -1 | 1): void {
  const section = sections.value[currentStepIndex.value + offset];
  if (section) emit('update:step', section.id);
  search.value = '';
}

function sourceLabel(source: 'alibaba-schema' | 'project'): string {
  if (source === 'alibaba-schema') return '平台必填与格式';
  return '内容优化建议';
}

async function focusIssue(issue: ProductDescriptionQualityIssue): Promise<void> {
  await focusReferences(issue.fieldIds);
}

async function focusOfficialHint(hint: ProductSchemaOfficialHint): Promise<void> {
  await focusReferences(hint.fieldKeys);
}

async function focusReferences(references: string[]): Promise<void> {
  for (const reference of references) {
    const target = findField(reference);
    if (!target) continue;
    optionalOpen.value = { ...optionalOpen.value, [target.sectionId]: true };
    emit('update:mode', 'guided');
    emit('update:step', target.sectionId);
    await nextTick();
    const element = globalThis.document.getElementById(productEditorFieldDomId(target.field.key));
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return;
  }
}

function findField(reference: string): { sectionId: ProductEditorStepId; field: ProductSchemaField } | null {
  for (const section of sections.value) {
    for (const entry of section.fields) {
      const field = findNestedField(entry.field, reference);
      if (field) return { sectionId: section.id, field };
    }
  }
  return null;
}

function findNestedField(field: ProductSchemaField, reference: string): ProductSchemaField | null {
  if (field.key === reference || field.id === reference) return field;
  for (const child of field.children) {
    const found = findNestedField(child, reference);
    if (found) return found;
  }
  for (const instance of field.instances) {
    for (const child of instance.fields) {
      const found = findNestedField(child, reference);
      if (found) return found;
    }
  }
  return null;
}
</script>

<template>
  <Card class="p-5">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div>
        <h2 class="font-semibold">{{ editing ? '编辑商品' : '发布新商品' }}</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          必填项完成 {{ completedRequiredCount }}/{{ requiredEntries.length }} ·
          {{ blockingIssues.length }} 个阻断问题 · {{ advisoryIssues.length }} 条建议
        </p>
      </div>
      <div class="flex gap-2" role="group" aria-label="商品编辑模式">
        <Button
          v-if="!editing"
          size="sm"
          :variant="mode === 'quick' ? 'default' : 'outline'"
          @click="emit('update:mode', 'quick')"
        >
          快速发布
        </Button>
        <Button
          size="sm"
          :variant="mode === 'guided' ? 'default' : 'outline'"
          @click="emit('update:mode', 'guided')"
        >
          新手向导
        </Button>
        <Button
          size="sm"
          :variant="mode === 'advanced' ? 'default' : 'outline'"
          @click="emit('update:mode', 'advanced')"
        >
          高级模式
        </Button>
      </div>
    </div>

    <PlatformDraftHandoff v-if="platformDraftId" :product-id="platformDraftId" />

    <ProductQuickEditor
      v-if="mode === 'quick' && !editing"
      :model="model"
      :issues="issues"
      :quality-issues="qualityIssues"
      :product-description-type="productDescriptionType"
      :language="language"
      :submit-pending="submitPending"
      :schema-inspection="schemaInspection"
      :publish-disabled="resolvedPublishDisabled"
      :draft-disabled="resolvedDraftDisabled"
      :publish-disabled-reason="publishDisabledReason"
      :draft-disabled-reason="draftDisabledReason"
      :platform-draft-id="platformDraftId"
      @update-field="(index, field) => emit('updateField', index, field)"
      @image-status="emit('imageStatus', $event)"
      @submit="emit('submit', $event)"
      @open-full="emit('update:mode', 'guided')"
    />

    <template v-else-if="mode === 'guided'">
      <nav class="my-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-6" aria-label="商品编辑步骤">
        <button
          v-for="(section, index) in sections"
          :key="section.id"
          type="button"
          class="rounded-lg border p-3 text-left text-xs transition-colors hover:border-primary"
          :class="step === section.id ? 'border-primary bg-accent' : 'bg-background'"
          :aria-current="step === section.id ? 'step' : undefined"
          @click="emit('update:step', section.id)"
        >
          <span class="flex items-center justify-between gap-1">
            <span class="font-medium">{{ index + 1 }}. {{ section.title }}</span>
            <Badge v-if="sectionIssueCount(section.id)" variant="destructive">
              {{ sectionIssueCount(section.id) }}
            </Badge>
          </span>
        </button>
      </nav>

      <section
        v-if="currentSection && currentSection.id !== 'review'"
        :aria-labelledby="`step-${currentSection.id}`"
      >
        <div class="mb-4">
          <h3 :id="`step-${currentSection.id}`" class="text-lg font-semibold">{{ currentSection.title }}</h3>
          <p class="mt-1 text-sm text-muted-foreground">{{ currentSection.description }}</p>
        </div>
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <div class="relative min-w-64 flex-1">
            <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input v-model="search" class="pl-9" aria-label="搜索当前步骤字段" placeholder="搜索当前步骤" />
          </div>
          <Button
            v-if="hiddenOptionalCount"
            variant="outline"
            size="sm"
            @click="optionalOpen[currentSection.id] = !optionalOpen[currentSection.id]"
          >
            {{ optionalOpen[currentSection.id] ? '收起选填信息' : `更多选填信息（${hiddenOptionalCount}）` }}
          </Button>
        </div>
        <TransitionGroup name="ov-list" tag="div" class="space-y-4">
          <ProductSchemaFieldComponent
            v-for="entry in visibleEntries"
            :key="entry.field.key"
            :field="entry.field"
            :issues="issues"
            :product-description-type="productDescriptionType"
            :language="language"
            :show-technical="false"
            @update="emit('updateField', entry.sourceIndex, $event)"
            @image-status="emit('imageStatus', $event)"
          />
          <p
            v-if="visibleEntries.length === 0"
            key="empty-fields"
            class="rounded-lg border p-8 text-center text-sm text-muted-foreground"
          >
            当前筛选下没有字段。
          </p>
        </TransitionGroup>
      </section>

      <section v-else aria-labelledby="product-review-title">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="product-review-title" class="text-lg font-semibold">检查与提交</h3>
            <p class="mt-1 text-sm text-muted-foreground">平台硬错误会阻止提交，其他建议不会禁用按钮。</p>
          </div>
          <Button
            v-if="scoreAvailable"
            variant="outline"
            size="sm"
            :disabled="scorePending"
            @click="emit('refreshScore')"
          >
            <RefreshCw class="size-4" />刷新官方评分
          </Button>
        </div>
        <p v-if="scoreError" class="mt-3 text-xs text-amber-700">
          官方评分暂时不可用，不影响编辑或提交：{{ scoreError }}
        </p>
        <div
          v-if="!schemaInspection.safe"
          class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p class="font-medium">Schema XML 结构异常，已阻止提交</p>
          <ul class="mt-2 list-disc pl-5">
            <li v-for="diff in schemaInspection.structuralDiffs" :key="diff">{{ diff }}</li>
          </ul>
        </div>
        <div class="mt-5 grid gap-4 lg:grid-cols-2">
          <section
            v-for="source in ['alibaba-schema', 'project'] as const"
            :key="source"
            class="rounded-lg border p-4"
          >
            <div class="flex items-center justify-between gap-2">
              <h4 class="font-medium">{{ sourceLabel(source) }}</h4>
              <Badge
                :variant="
                  source === 'alibaba-schema' && issuesBySource[source].length ? 'destructive' : 'secondary'
                "
              >
                {{ issuesBySource[source].length }}
              </Badge>
            </div>
            <p v-if="issuesBySource[source].length === 0" class="mt-4 text-sm text-muted-foreground">
              暂无问题
            </p>
            <ul v-else class="mt-4 space-y-3 text-sm">
              <li v-for="issue in issuesBySource[source]" :key="`${issue.code}:${issue.message}`">
                <button type="button" class="text-left hover:underline" @click="focusIssue(issue)">
                  <span :class="issue.level === 'error' ? 'font-medium text-destructive' : 'font-medium'">
                    {{ issue.message }}
                  </span>
                </button>
                <p class="mt-1 text-xs text-muted-foreground">{{ issue.remediation }}</p>
              </li>
            </ul>
          </section>

          <section class="rounded-lg border p-4 lg:col-span-2" aria-labelledby="official-hints-title">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 id="official-hints-title" class="font-medium">官方提示</h4>
                <p class="mt-1 text-xs text-muted-foreground">
                  已按字段合并重复内容；展开后可查看官方链接和 Schema 示例。
                </p>
              </div>
              <Badge variant="secondary">{{ officialHints.length }}</Badge>
            </div>
            <p v-if="officialHintGroups.length === 0" class="mt-4 text-sm text-muted-foreground">暂无问题</p>
            <div v-else class="mt-4 space-y-4">
              <section v-for="group in officialHintGroups" :key="group.id" class="rounded-lg bg-muted/35 p-3">
                <div class="mb-3 flex flex-wrap items-center gap-2">
                  <h5 class="font-medium">{{ group.label }}</h5>
                  <Badge variant="outline">{{ group.hints.length }} 条</Badge>
                  <span v-if="group.fieldCount" class="text-xs text-muted-foreground">
                    影响 {{ group.fieldCount }} 个字段
                  </span>
                  <span v-else class="text-xs text-muted-foreground">平台评分</span>
                </div>
                <div class="space-y-2">
                  <OfficialHintContent
                    v-for="hint in group.hints"
                    :key="hint.id"
                    :hint="hint"
                    @locate="focusOfficialHint(hint)"
                  />
                </div>
              </section>
            </div>
          </section>
        </div>
        <div v-if="model.warnings.length" class="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          <p class="font-medium">提交时需由平台最终检查</p>
          <p class="mt-1 text-xs">有 {{ model.warnings.length }} 条规则无法在浏览器中安全计算。</p>
        </div>
      </section>

      <div
        class="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 py-4 backdrop-blur"
      >
        <Button variant="outline" :disabled="currentStepIndex <= 0" @click="moveStep(-1)">
          <ChevronLeft class="size-4" />上一步
        </Button>
        <div v-if="currentSection?.id === 'review'" class="flex flex-wrap gap-2">
          <Button
            :disabled="
              submitPending || resolvedPublishDisabled || blockingIssues.length > 0 || !schemaInspection.safe
            "
            @click="emit('submit', false)"
          >
            <Send class="size-4" />{{ editing ? '更新商品' : '发布商品' }} ·
            {{ advisoryIssues.length }} 条建议
          </Button>
          <Button
            v-if="!editing"
            variant="outline"
            :disabled="
              submitPending || resolvedDraftDisabled || Boolean(platformDraftId) || !schemaInspection.safe
            "
            @click="emit('submit', true)"
          >
            <Save class="size-4" />保存平台草稿
          </Button>
        </div>
        <Button v-else @click="moveStep(1)">下一步<ChevronRight class="size-4" /></Button>
      </div>
    </template>

    <template v-else>
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
        <p class="font-medium">服务端规则提示</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="warning in model.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>
      <details class="mt-5 rounded-lg border p-3">
        <summary class="flex cursor-pointer items-center gap-2 text-sm font-medium">
          Schema XML 预览（只读）
          <Badge
            :variant="
              schemaInspection.safe ? (schemaInspection.noOp ? 'secondary' : 'success') : 'destructive'
            "
          >
            {{ serializationLabel }}
          </Badge>
        </summary>
        <p v-if="changedFieldNames.length" class="mt-3 text-xs text-muted-foreground">
          实际变化字段：{{ changedFieldNames.join('、') }}
        </p>
        <div
          v-if="!schemaInspection.safe"
          class="mt-3 rounded-md bg-destructive/10 p-3 text-xs text-destructive"
        >
          <p v-for="diff in schemaInspection.structuralDiffs" :key="diff">{{ diff }}</p>
        </div>
        <pre
          class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap bg-slate-950 p-3 text-xs text-slate-100"
          >{{ schemaPreview }}</pre>
      </details>
      <div class="mt-5 flex flex-wrap gap-2">
        <Button
          :disabled="
            submitPending || resolvedPublishDisabled || blockingIssues.length > 0 || !schemaInspection.safe
          "
          @click="emit('submit', false)"
        >
          <Send class="size-4" />{{ editing ? '更新商品' : '发布商品' }} · {{ advisoryIssues.length }} 条建议
        </Button>
        <Button
          v-if="!editing"
          variant="outline"
          :disabled="
            submitPending || resolvedDraftDisabled || Boolean(platformDraftId) || !schemaInspection.safe
          "
          @click="emit('submit', true)"
        >
          <Save class="size-4" />保存平台草稿
        </Button>
      </div>
    </template>

    <div
      v-if="resolvedPublishDisabled || resolvedDraftDisabled"
      class="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <ShieldAlert class="mt-0.5 size-4 shrink-0" />
      {{
        (editing ? publishDisabledReason : draftDisabledReason || publishDisabledReason) ||
        '当前真实写操作尚未开放。'
      }}
    </div>
  </Card>
</template>
