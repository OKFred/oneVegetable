<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Archive, ArchiveRestore, FilePlus2, LayoutTemplate, Pencil } from '@lucide/vue';

import { sanitizeProductDescriptionHtml } from '@one-vegetable/core/browser';
import {
  type ProductDescriptionTemplate,
  type ProductDescriptionTemplateCategory,
  type ProductDescriptionTemplateLanguage
} from '@one-vegetable/core';

import SafeHtmlContent from './SafeHtmlContent.vue';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import { useServices } from '../lib/services';

type ApplyMode = 'insert' | 'append' | 'replace';
type PanelView = 'browse' | 'edit' | 'replace';

const props = defineProps<{
  language: ProductDescriptionTemplateLanguage;
  currentHtml: string;
}>();
const emit = defineEmits<{ apply: [payload: { mode: ApplyMode; html: string }] }>();

const { productDescriptionTemplates, mode } = useServices();
const open = ref(false);
const view = ref<PanelView>('browse');
const templates = ref<ProductDescriptionTemplate[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const showArchived = ref(false);
const selected = ref<ProductDescriptionTemplate | null>(null);
const formId = ref<string | null>(null);
const formRevision = ref(0);
const formName = ref('');
const formCategory = ref<ProductDescriptionTemplateCategory>('custom');
const formHtml = ref('');
const formRemark = ref('');

const canManage = computed(() => mode !== 'extension' && productDescriptionTemplates !== undefined);
const visibleTemplates = computed(() =>
  templates.value.filter((template) => showArchived.value || template.status === 'active')
);
const title = computed(() => {
  if (view.value === 'edit') return formId.value ? '编辑共享详情模板' : '新建共享详情模板';
  if (view.value === 'replace') return '确认覆盖商品详情';
  return '商品详情模板';
});
const description = computed(() => {
  if (view.value === 'replace') return '覆盖会替换当前详情全文；确认前请对照两侧预览。';
  if (view.value === 'edit') return '共享模板对当前 BFF 的所有有效用户可见。';
  return '模板插入后就是普通富文本，请将占位内容替换为真实信息。';
});
const currentSafeHtml = computed(() => sanitizeProductDescriptionHtml(props.currentHtml).html);
const selectedSafeHtml = computed(() =>
  selected.value ? sanitizeProductDescriptionHtml(selected.value.html).html : ''
);

watch(open, (value) => {
  if (value) void loadTemplates();
  else resetView();
});
watch(
  () => props.language,
  () => {
    if (open.value) void loadTemplates();
  }
);

async function loadTemplates(): Promise<void> {
  if (!productDescriptionTemplates) return;
  loading.value = true;
  error.value = '';
  try {
    const result = await productDescriptionTemplates.list({ language: props.language, pageSize: 100 });
    templates.value = result.items;
  } catch (reason: unknown) {
    error.value = messageOf(reason);
  } finally {
    loading.value = false;
  }
}

function applyTemplate(template: ProductDescriptionTemplate, applyMode: ApplyMode): void {
  if (applyMode === 'replace') {
    selected.value = template;
    view.value = 'replace';
    return;
  }
  emit('apply', { mode: applyMode, html: template.html });
  open.value = false;
}

function confirmReplace(): void {
  if (!selected.value) return;
  emit('apply', { mode: 'replace', html: selected.value.html });
  open.value = false;
}

function startCreate(): void {
  formId.value = null;
  formRevision.value = 0;
  formName.value = '';
  formCategory.value = 'custom';
  formHtml.value = currentSafeHtml.value;
  formRemark.value = '';
  error.value = '';
  view.value = 'edit';
}

function startEdit(template: ProductDescriptionTemplate): void {
  formId.value = template.id;
  formRevision.value = template.revision;
  formName.value = template.name;
  formCategory.value = template.category;
  formHtml.value = template.html;
  formRemark.value = template.remark ?? '';
  error.value = '';
  view.value = 'edit';
}

async function saveTemplate(): Promise<void> {
  if (!productDescriptionTemplates || !formName.value.trim() || !formHtml.value.trim()) return;
  saving.value = true;
  error.value = '';
  try {
    if (formId.value) {
      await productDescriptionTemplates.update({
        id: formId.value,
        revision: formRevision.value,
        name: formName.value,
        category: formCategory.value,
        language: props.language,
        html: formHtml.value,
        remark: formRemark.value.trim() || null
      });
    } else {
      await productDescriptionTemplates.create({
        name: formName.value,
        category: formCategory.value,
        language: props.language,
        html: formHtml.value,
        remark: formRemark.value.trim() || null
      });
    }
    view.value = 'browse';
    await loadTemplates();
  } catch (reason: unknown) {
    error.value = messageOf(reason);
  } finally {
    saving.value = false;
  }
}

async function changeStatus(template: ProductDescriptionTemplate): Promise<void> {
  if (!productDescriptionTemplates) return;
  saving.value = true;
  error.value = '';
  try {
    if (template.status === 'active') {
      await productDescriptionTemplates.archive(template.id, template.revision);
    } else {
      await productDescriptionTemplates.restore(template.id, template.revision);
    }
    await loadTemplates();
  } catch (reason: unknown) {
    error.value = messageOf(reason);
  } finally {
    saving.value = false;
  }
}

function resetView(): void {
  view.value = 'browse';
  selected.value = null;
  error.value = '';
}

function isBundled(template: ProductDescriptionTemplate): boolean {
  return template.creatorId === 'system:bundled';
}

function categoryLabel(category: ProductDescriptionTemplateCategory): string {
  return {
    company: '公司介绍',
    logistics: '物流介绍',
    packaging: '包装说明',
    service: '服务保障',
    custom: '自定义'
  }[category];
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : '详情模板操作失败';
}
</script>

<template>
  <Button variant="outline" size="sm" :disabled="!productDescriptionTemplates" @click="open = true">
    <LayoutTemplate class="size-4" />详情模板
  </Button>

  <ModalDialog v-model:open="open" :title="title" :description="description" size="lg">
    <template v-if="view === 'browse'">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input v-model="showArchived" type="checkbox" />显示已归档共享模板
        </label>
        <Button v-if="canManage" variant="outline" size="sm" @click="startCreate">
          <FilePlus2 class="size-4" />新建共享模板
        </Button>
      </div>
      <p v-if="loading && templates.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        正在读取模板…
      </p>
      <p v-else-if="visibleTemplates.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        当前语言暂无可用模板。
      </p>
      <template v-else>
        <p v-if="loading" class="mb-3 text-xs text-muted-foreground" role="status">正在刷新模板…</p>
        <div class="grid gap-3 md:grid-cols-2" :aria-busy="loading">
          <article v-for="template in visibleTemplates" :key="template.id" class="rounded-lg border p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate font-medium">{{ template.name }}</p>
                <div class="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline">{{ categoryLabel(template.category) }}</Badge>
                  <Badge v-if="isBundled(template)" variant="secondary">内置</Badge>
                  <Badge v-if="template.status === 'archived'" variant="warning">已归档</Badge>
                </div>
              </div>
            </div>
            <p v-if="template.remark" class="mt-3 line-clamp-2 text-xs text-muted-foreground">
              {{ template.remark }}
            </p>
            <div v-if="template.status === 'active'" class="mt-4 flex flex-wrap gap-2">
              <Button size="sm" @click="applyTemplate(template, 'insert')">插入光标处</Button>
              <Button size="sm" variant="outline" @click="applyTemplate(template, 'append')">追加末尾</Button>
              <Button size="sm" variant="ghost" @click="applyTemplate(template, 'replace')">覆盖全文</Button>
            </div>
            <div v-if="canManage && !isBundled(template)" class="mt-3 flex flex-wrap gap-2 border-t pt-3">
              <Button
                v-if="template.status === 'active'"
                size="sm"
                variant="ghost"
                @click="startEdit(template)"
              >
                <Pencil class="size-3" />编辑
              </Button>
              <Button size="sm" variant="ghost" :disabled="saving" @click="changeStatus(template)">
                <Archive v-if="template.status === 'active'" class="size-3" />
                <ArchiveRestore v-else class="size-3" />
                {{ template.status === 'active' ? '归档' : '恢复' }}
              </Button>
            </div>
          </article>
        </div>
      </template>
    </template>

    <template v-else-if="view === 'edit'">
      <div class="space-y-4">
        <label class="block text-sm font-medium">模板名称<Input v-model="formName" class="mt-2" /></label>
        <label class="block text-sm font-medium">
          模板分类
          <select v-model="formCategory" class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="company">公司介绍</option>
            <option value="logistics">物流介绍</option>
            <option value="packaging">包装说明</option>
            <option value="service">服务保障</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        <label class="block text-sm font-medium">
          安全 HTML
          <textarea
            v-model="formHtml"
            class="mt-2 min-h-56 w-full rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label class="block text-sm font-medium">备注<Input v-model="formRemark" class="mt-2" /></label>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="view = 'browse'">取消</Button>
          <Button :disabled="saving || !formName.trim() || !formHtml.trim()" @click="saveTemplate">
            保存共享模板
          </Button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="grid gap-4 md:grid-cols-2">
        <section class="min-w-0 rounded-lg border p-3">
          <h3 class="mb-3 text-sm font-medium">当前详情</h3>
          <SafeHtmlContent :html="currentSafeHtml" class="max-h-80 overflow-auto text-sm" />
        </section>
        <section class="min-w-0 rounded-lg border border-primary/40 p-3">
          <h3 class="mb-3 text-sm font-medium">覆盖后：{{ selected?.name }}</h3>
          <SafeHtmlContent :html="selectedSafeHtml" class="max-h-80 overflow-auto text-sm" />
        </section>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" @click="view = 'browse'">返回</Button>
        <Button @click="confirmReplace">确认覆盖全文</Button>
      </div>
    </template>

    <p v-if="error" class="mt-4 text-sm text-destructive">{{ error }}</p>
  </ModalDialog>
</template>
