<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Archive, ArchiveRestore, FilePlus2, LayoutTemplate, Pencil, RefreshCw } from '@lucide/vue';

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
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';

type ApplyMode = 'insert' | 'append' | 'replace';
type PanelView = 'browse' | 'edit' | 'replace';

const props = defineProps<{
  language: ProductDescriptionTemplateLanguage;
  currentHtml: string;
}>();
const emit = defineEmits<{ apply: [payload: { mode: ApplyMode; html: string }] }>();

const { productDescriptionTemplates, mode } = useServices();
const { locale, t } = useUiI18n();
const open = ref(false);
const view = ref<PanelView>('browse');
const templates = ref<ProductDescriptionTemplate[]>([]);
const loadedLanguage = ref<ProductDescriptionTemplateLanguage | null>(null);
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
let loadSequence = 0;

const canManage = computed(() => mode !== 'extension' && productDescriptionTemplates !== undefined);
const visibleTemplates = computed(() =>
  templates.value.filter((template) => showArchived.value || template.status === 'active')
);
const title = computed(() => {
  if (view.value === 'edit') {
    return t(formId.value ? 'products.templates.editTitle' : 'products.templates.createTitle');
  }
  if (view.value === 'replace') return t('products.templates.replaceTitle');
  return t('products.templates.title');
});
const description = computed(() => {
  if (view.value === 'replace') return t('products.templates.replaceDescription');
  if (view.value === 'edit') return t('products.templates.editDescription');
  return t('products.templates.browseDescription');
});
const currentSafeHtml = computed(() => sanitizeProductDescriptionHtml(props.currentHtml, locale.value).html);
const selectedSafeHtml = computed(() =>
  selected.value ? sanitizeProductDescriptionHtml(selected.value.html, locale.value).html : ''
);

watch(open, (value) => {
  if (value && loadedLanguage.value !== props.language) void loadTemplates();
  else resetView();
});
watch(
  () => props.language,
  () => {
    loadedLanguage.value = null;
    templates.value = [];
    if (open.value) void loadTemplates();
  }
);

async function loadTemplates(): Promise<void> {
  if (!productDescriptionTemplates) return;
  const sequence = ++loadSequence;
  const requestedLanguage = props.language;
  loading.value = true;
  error.value = '';
  try {
    const result = await productDescriptionTemplates.list({ language: requestedLanguage, pageSize: 100 });
    if (sequence !== loadSequence || requestedLanguage !== props.language) return;
    templates.value = result.items;
    loadedLanguage.value = requestedLanguage;
  } catch (reason: unknown) {
    if (sequence !== loadSequence) return;
    error.value = messageOf(reason);
  } finally {
    if (sequence === loadSequence) loading.value = false;
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
  return t(`products.templates.categories.${category}`);
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : t('products.templates.operationFailed');
}
</script>

<template>
  <Button variant="outline" size="sm" :disabled="!productDescriptionTemplates" @click="open = true">
    <LayoutTemplate class="size-4" />{{ t('products.templates.title') }}
  </Button>

  <ModalDialog v-model:open="open" :title="title" :description="description" size="lg">
    <template v-if="view === 'browse'">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input v-model="showArchived" type="checkbox" :disabled="loading" />{{
            t('products.templates.showArchived')
          }}
        </label>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" :disabled="loading" @click="loadTemplates">
            <RefreshCw class="size-4" :class="loading ? 'animate-spin' : ''" />{{
              t('common.actions.refresh')
            }}
          </Button>
          <Button v-if="canManage" variant="outline" size="sm" :disabled="loading" @click="startCreate">
            <FilePlus2 class="size-4" />{{ t('products.templates.create') }}
          </Button>
        </div>
      </div>
      <p v-if="loading && templates.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        {{ t('products.templates.loading') }}
      </p>
      <p v-else-if="visibleTemplates.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        {{ t('products.templates.empty') }}
      </p>
      <template v-else>
        <p v-if="loading" class="mb-3 text-xs text-muted-foreground" role="status">
          {{ t('products.templates.refreshing') }}
        </p>
        <div class="grid gap-3 md:grid-cols-2" :aria-busy="loading">
          <article v-for="template in visibleTemplates" :key="template.id" class="rounded-lg border p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate font-medium">{{ template.name }}</p>
                <div class="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline">{{ categoryLabel(template.category) }}</Badge>
                  <Badge v-if="isBundled(template)" variant="secondary">{{
                    t('products.templates.bundled')
                  }}</Badge>
                  <Badge v-if="template.status === 'archived'" variant="warning">
                    {{ t('products.templates.archived') }}
                  </Badge>
                </div>
              </div>
            </div>
            <p v-if="template.remark" class="mt-3 line-clamp-2 text-xs text-muted-foreground">
              {{ template.remark }}
            </p>
            <div v-if="template.status === 'active'" class="mt-4 flex flex-wrap gap-2">
              <Button size="sm" :disabled="loading" @click="applyTemplate(template, 'insert')">{{
                t('products.templates.insert')
              }}</Button>
              <Button
                size="sm"
                variant="outline"
                :disabled="loading"
                @click="applyTemplate(template, 'append')"
              >
                {{ t('products.templates.append') }}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                :disabled="loading"
                @click="applyTemplate(template, 'replace')"
              >
                {{ t('products.templates.replace') }}
              </Button>
            </div>
            <div v-if="canManage && !isBundled(template)" class="mt-3 flex flex-wrap gap-2 border-t pt-3">
              <Button
                v-if="template.status === 'active'"
                size="sm"
                variant="ghost"
                :disabled="loading"
                @click="startEdit(template)"
              >
                <Pencil class="size-3" />{{ t('products.templates.edit') }}
              </Button>
              <Button size="sm" variant="ghost" :disabled="loading || saving" @click="changeStatus(template)">
                <Archive v-if="template.status === 'active'" class="size-3" />
                <ArchiveRestore v-else class="size-3" />
                {{
                  t(
                    template.status === 'active' ? 'products.templates.archive' : 'products.templates.restore'
                  )
                }}
              </Button>
            </div>
          </article>
        </div>
      </template>
    </template>

    <template v-else-if="view === 'edit'">
      <div class="space-y-4">
        <label class="block text-sm font-medium">
          {{ t('products.templates.name') }}<Input v-model="formName" class="mt-2" />
        </label>
        <label class="block text-sm font-medium">
          {{ t('products.templates.category') }}
          <select v-model="formCategory" class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="company">{{ t('products.templates.categories.company') }}</option>
            <option value="logistics">{{ t('products.templates.categories.logistics') }}</option>
            <option value="packaging">{{ t('products.templates.categories.packaging') }}</option>
            <option value="service">{{ t('products.templates.categories.service') }}</option>
            <option value="custom">{{ t('products.templates.categories.custom') }}</option>
          </select>
        </label>
        <label class="block text-sm font-medium">
          {{ t('products.templates.safeHtml') }}
          <textarea
            v-model="formHtml"
            class="mt-2 min-h-56 w-full rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label class="block text-sm font-medium">
          {{ t('products.templates.remark') }}<Input v-model="formRemark" class="mt-2" />
        </label>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="view = 'browse'">{{ t('common.actions.cancel') }}</Button>
          <Button :disabled="saving || !formName.trim() || !formHtml.trim()" @click="saveTemplate">
            {{ t('products.templates.save') }}
          </Button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="grid gap-4 md:grid-cols-2">
        <section class="min-w-0 rounded-lg border p-3">
          <h3 class="mb-3 text-sm font-medium">{{ t('products.templates.current') }}</h3>
          <SafeHtmlContent :html="currentSafeHtml" class="max-h-80 overflow-auto text-sm" />
        </section>
        <section class="min-w-0 rounded-lg border border-primary/40 p-3">
          <h3 class="mb-3 text-sm font-medium">
            {{ t('products.templates.afterReplace', { name: selected?.name ?? '' }) }}
          </h3>
          <SafeHtmlContent :html="selectedSafeHtml" class="max-h-80 overflow-auto text-sm" />
        </section>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" @click="view = 'browse'">{{ t('products.templates.back') }}</Button>
        <Button @click="confirmReplace">{{ t('products.templates.confirmReplace') }}</Button>
      </div>
    </template>

    <p v-if="error" class="mt-4 text-sm text-destructive">{{ error }}</p>
  </ModalDialog>
</template>
