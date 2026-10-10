<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, shallowRef, watch } from 'vue';
import {
  Archive,
  ArchiveRestore,
  Download,
  Eye,
  FilePlus2,
  LayoutTemplate,
  Pencil,
  RefreshCw,
  Upload
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { listAllTemplates } from '@one-vegetable/core/template-library';

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
import ErrorNotice from './ErrorNotice.vue';
import TriStateCheckbox from './TriStateCheckbox.vue';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import { useUnsavedEditing } from '../lib/unsaved-editing';

type ApplyMode = 'insert' | 'append' | 'replace';
type PanelView = 'browse' | 'edit' | 'replace';

const props = defineProps<{
  language: ProductDescriptionTemplateLanguage;
  currentHtml: string;
  standalone?: boolean;
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
const operationError = shallowRef<unknown>(null);
const showArchived = ref(false);
const search = ref('');
const selectedIds = ref<string[]>([]);
const transferMode = ref<'import' | 'export' | null>(null);
const previewTemplate = ref<ProductDescriptionTemplate | null>(null);
const ProductDescriptionEditor = defineAsyncComponent(() => import('./ProductDescriptionEditor.vue'));
const TemplateTransferDialog = defineAsyncComponent(() => import('./TemplateTransferDialog.vue'));
const selected = ref<ProductDescriptionTemplate | null>(null);
const formId = ref<string | null>(null);
const formRevision = ref(0);
const formName = ref('');
const formCategory = ref<ProductDescriptionTemplateCategory>('custom');
const formHtml = ref('');
const formRemark = ref('');
const editing = useUnsavedEditing(
  () => [formName.value, formCategory.value, formHtml.value, formRemark.value],
  { enabled: () => open.value && view.value === 'edit' }
);
let loadSequence = 0;

const canManage = computed(() => productDescriptionTemplates !== undefined);
const visibleTemplates = computed(() =>
  templates.value.filter(
    (template) =>
      (showArchived.value || template.status === 'active') &&
      template.name.toLowerCase().includes(search.value.trim().toLowerCase())
  )
);
const exportTemplates = computed(() => templates.value.filter((item) => selectedIds.value.includes(item.id)));
const allSelected = computed(
  () =>
    visibleTemplates.value.length > 0 &&
    visibleTemplates.value.every((item) => selectedIds.value.includes(item.id))
);
const partlySelected = computed(
  () => !allSelected.value && visibleTemplates.value.some((item) => selectedIds.value.includes(item.id))
);
function toggleSelection(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((value) => value !== id)
    : [...selectedIds.value, id];
}
function selectVisible(): void {
  const ids = new Set(visibleTemplates.value.map((item) => item.id));
  selectedIds.value = allSelected.value
    ? selectedIds.value.filter((id) => !ids.has(id))
    : [...new Set([...selectedIds.value, ...ids])];
}
const title = computed(() => {
  if (view.value === 'edit') {
    return t(formId.value ? 'products.templates.editTitle' : 'products.templates.createTitle');
  }
  if (view.value === 'replace') return t('products.templates.replaceTitle');
  return t('products.templates.title');
});
const description = computed(() => {
  if (view.value === 'replace') return t('products.templates.replaceDescription');
  if (view.value === 'edit')
    return t(
      mode === 'extension' ? 'products.templates.localDescription' : 'products.templates.editDescription'
    );
  return t('products.templates.browseDescription');
});
const currentSafeHtml = computed(() => sanitizeProductDescriptionHtml(props.currentHtml, locale.value).html);
const selectedSafeHtml = computed(() =>
  selected.value ? sanitizeProductDescriptionHtml(selected.value.html, locale.value).html : ''
);

watch(open, (value) => {
  if (!value) return;
  // Presence retains closing content for its exit animation. Keep its title and
  // view intact until the next open so a closing editor cannot become a browser.
  resetView();
  if (loadedLanguage.value !== props.language) void loadTemplates();
});
onMounted(() => {
  if (props.standalone) open.value = true;
});
watch(
  () => props.language,
  () => {
    loadedLanguage.value = null;
    templates.value = [];
    selectedIds.value = [];
    resetView();
    if (open.value) void loadTemplates();
  }
);

async function loadTemplates(): Promise<void> {
  if (!productDescriptionTemplates) return;
  const sequence = ++loadSequence;
  const requestedLanguage = props.language;
  loading.value = true;
  operationError.value = null;
  try {
    const result = await listAllTemplates(productDescriptionTemplates, requestedLanguage);
    if (sequence !== loadSequence || requestedLanguage !== props.language) return;
    templates.value = result;
    selectedIds.value = selectedIds.value.filter((id) => result.some((item) => item.id === id));
    loadedLanguage.value = requestedLanguage;
  } catch (reason: unknown) {
    if (sequence !== loadSequence) return;
    operationError.value = reason;
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
  view.value = 'edit';
  operationError.value = null;
  editing.markClean();
}

function startEdit(template: ProductDescriptionTemplate): void {
  formId.value = template.id;
  formRevision.value = template.revision;
  formName.value = template.name;
  formCategory.value = template.category;
  formHtml.value = template.html;
  formRemark.value = template.remark ?? '';
  view.value = 'edit';
  operationError.value = null;
  editing.markClean();
}

async function saveTemplate(): Promise<void> {
  if (!productDescriptionTemplates || !formName.value.trim() || !formHtml.value.trim()) return;
  saving.value = true;
  operationError.value = null;
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
    editing.markClean();
    toast.success(t('products.templates.saved'));
    view.value = 'browse';
    await loadTemplates();
  } catch (reason: unknown) {
    operationError.value = reason;
  } finally {
    saving.value = false;
  }
}

async function changeStatus(template: ProductDescriptionTemplate): Promise<void> {
  if (!productDescriptionTemplates) return;
  saving.value = true;
  operationError.value = null;
  try {
    if (template.status === 'active') {
      await productDescriptionTemplates.archive(template.id, template.revision);
    } else {
      await productDescriptionTemplates.restore(template.id, template.revision);
    }
    await loadTemplates();
  } catch (reason: unknown) {
    operationError.value = reason;
  } finally {
    saving.value = false;
  }
}

function resetView(): void {
  view.value = 'browse';
  selected.value = null;
  operationError.value = null;
}

function isBundled(template: ProductDescriptionTemplate): boolean {
  return template.creatorId === 'system:bundled';
}

function categoryLabel(category: ProductDescriptionTemplateCategory): string {
  return t(`products.templates.categories.${category}`);
}
</script>

<template>
  <Button
    v-if="!standalone"
    variant="outline"
    size="sm"
    :disabled="!productDescriptionTemplates"
    @click="open = true"
  >
    <LayoutTemplate class="size-4" />{{ t('products.templates.title') }}
  </Button>

  <component
    :is="standalone ? 'section' : ModalDialog"
    v-bind="standalone ? {} : { open, title, description, size: 'lg', dismissible: !saving }"
    @update:open="
      editing.guard(() => {
        if (!saving) open = $event;
      })
    "
  >
    <h2 v-if="standalone && view !== 'browse'" class="mb-2 font-medium">{{ title }}</h2>
    <p v-if="standalone" class="mb-4 text-sm text-muted-foreground">{{ description }}</p>
    <template v-if="view === 'browse'">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Input
          v-model="search"
          class="max-w-sm"
          :placeholder="t('products.templates.search')"
          :aria-label="t('products.templates.search')"
        />
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input v-model="showArchived" type="checkbox" :disabled="loading" />{{
            t('products.templates.showArchived')
          }}
        </label>
        <div class="flex flex-wrap justify-end gap-2">
          <Button v-if="canManage" variant="outline" size="sm" @click="transferMode = 'import'"
            ><Upload class="size-4" />{{ t('products.transfer.import') }}</Button
          >
          <Button
            variant="outline"
            size="sm"
            :disabled="exportTemplates.length === 0 || exportTemplates.length > 100"
            @click="transferMode = 'export'"
            ><Download class="size-4" />{{ t('products.transfer.export') }}</Button
          >
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
      <div class="mb-3 flex items-center gap-2 text-sm">
        <TriStateCheckbox
          :checked="allSelected"
          :indeterminate="partlySelected"
          :disabled="visibleTemplates.length === 0"
          :label="t('common.data.selectPage')"
          @update:checked="selectVisible"
        />
        {{ t('common.data.selected', { count: selectedIds.length }) }}
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
            <div class="flex items-start gap-3">
              <TriStateCheckbox
                :checked="selectedIds.includes(template.id)"
                :label="t('common.data.selectRow', { name: template.name })"
                @update:checked="toggleSelection(template.id)"
              />
              <div class="min-w-0 flex-1">
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
            <Button
              v-if="standalone"
              size="sm"
              variant="ghost"
              class="mt-3"
              @click="previewTemplate = template"
              ><Eye class="size-4" />{{ t('products.templates.preview') }}</Button
            >
            <div v-if="!standalone && template.status === 'active'" class="mt-4 flex flex-wrap gap-2">
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
      <div class="space-y-4" :inert="saving">
        <label class="block text-sm font-medium">
          {{ t('products.templates.name') }}<Input v-model="formName" class="mt-2" />
        </label>
        <ProductDescriptionEditor v-model="formHtml" :language="language" :show-templates="false" />
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
        <details class="rounded-md border p-3">
          <summary class="cursor-pointer text-sm font-medium">{{ t('products.templates.safeHtml') }}</summary>
          <textarea
            v-model="formHtml"
            :aria-label="t('products.templates.safeHtml')"
            class="mt-2 min-h-56 w-full rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </details>
        <label class="block text-sm font-medium">
          {{ t('products.templates.remark') }}<Input v-model="formRemark" class="mt-2" />
        </label>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="editing.guard(resetView)">{{ t('common.actions.cancel') }}</Button>
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

    <ErrorNotice v-if="operationError" :error="operationError" compact />
  </component>
  <ModalDialog
    :open="previewTemplate !== null"
    :title="previewTemplate?.name ?? ''"
    :description="t('products.templates.browseDescription')"
    @update:open="previewTemplate = null"
  >
    <SafeHtmlContent :html="previewTemplate?.html ?? ''" />
  </ModalDialog>
  <TemplateTransferDialog
    v-if="transferMode"
    :open="true"
    :mode="transferMode"
    :templates="exportTemplates"
    @update:open="transferMode = null"
    @imported="loadTemplates"
  />
</template>
