<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import {
  Bold,
  Braces,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Table2,
  Underline as UnderlineIcon
} from '@lucide/vue';

import { sanitizeProductDescriptionHtml } from '@one-vegetable/core/browser';
import {
  type Photo,
  type ProductDescriptionImageMetadata,
  type ProductDescriptionSanitizationChange
} from '@one-vegetable/core';

import PhotoBankPicker from './PhotoBankPicker.vue';
import ProductDescriptionTemplatePanel from './ProductDescriptionTemplatePanel.vue';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import { useUiI18n } from '../i18n';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    smartDetail?: boolean;
    language?: 'zh_CN' | 'en_US';
  }>(),
  { smartDetail: false, language: 'en_US' }
);
const emit = defineEmits<{
  'update:modelValue': [html: string];
  converted: [];
  imageStatus: [status: ProductDescriptionImageMetadata & { url: string }];
}>();
const { locale, t } = useUiI18n();

const PhotoBankImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-photobank-file-id': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-photobank-file-id')
      },
      'data-photobank-width': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-photobank-width')
      },
      'data-photobank-height': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-photobank-height')
      }
    };
  }
});

const inspection = computed(() => sanitizeProductDescriptionHtml(props.modelValue, locale.value));
const converted = ref(false);
const reviewingConversion = ref(false);
const readOnlyView = ref<'preview' | 'source'>('preview');
const linkUrl = ref('');
const pickedPhotos = ref<Photo[]>([]);
const requiresConversion = computed(() => props.smartDetail || !inspection.value.supported);
const editable = computed(() => !requiresConversion.value || converted.value);
const conversionChanges = computed<ProductDescriptionSanitizationChange[]>(() => {
  const changes = [...inspection.value.changes];
  if (props.smartDetail) {
    changes.unshift({
      type: 'unwrapped-element',
      target: 'smart-detail',
      detail: t('products.descriptionEditor.smartConversion')
    });
  }
  return changes;
});

const editor = useEditor({
  content: inspection.value.html,
  editable: editable.value,
  extensions: [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      strike: false,
      heading: { levels: [2, 3, 4] },
      link: false,
      underline: false
    }),
    Underline,
    Link.configure({
      autolink: false,
      linkOnPaste: false,
      openOnClick: false,
      protocols: ['http', 'https'],
      HTMLAttributes: { rel: 'nofollow noopener noreferrer', target: '_blank' }
    }),
    PhotoBankImage.configure({ allowBase64: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell
  ],
  onUpdate: ({ editor: currentEditor }) => {
    if (!editable.value) return;
    emit('update:modelValue', sanitizeProductDescriptionHtml(currentEditor.getHTML(), locale.value).html);
  }
});

watch(editable, (value) => editor.value?.setEditable(value));
watch(
  () => props.modelValue,
  (value) => {
    if (!editor.value) return;
    const safeHtml = sanitizeProductDescriptionHtml(value, locale.value).html;
    if (safeHtml !== editor.value.getHTML())
      editor.value.commands.setContent(safeHtml, { emitUpdate: false });
  }
);
onBeforeUnmount(() => editor.value?.destroy());

function confirmConversion(): void {
  converted.value = true;
  reviewingConversion.value = false;
  editor.value?.commands.setContent(inspection.value.html, { emitUpdate: false });
  editor.value?.setEditable(true);
  emit('update:modelValue', inspection.value.html);
  emit('converted');
}

function setLink(): void {
  if (!editor.value) return;
  if (!linkUrl.value) {
    editor.value.chain().focus().unsetLink().run();
    return;
  }
  editor.value.chain().focus().extendMarkRange('link').setLink({ href: linkUrl.value }).run();
  linkUrl.value = '';
}

function insertPhoto(photos: Photo[]): void {
  const photo = photos.at(-1);
  pickedPhotos.value = [];
  if (!photo || !editor.value) return;
  editor.value
    .chain()
    .insertContent({
      type: 'image',
      attrs: {
        src: photo.url,
        alt: photo.name.replace(/\.[^.]+$/, ''),
        'data-photobank-file-id': photo.id,
        'data-photobank-width': photo.width === null ? null : String(photo.width),
        'data-photobank-height': photo.height === null ? null : String(photo.height)
      }
    })
    .run();
}

function applyTemplate(payload: { mode: 'insert' | 'append' | 'replace'; html: string }): void {
  if (!editor.value || !editable.value) return;
  const html = sanitizeProductDescriptionHtml(payload.html, locale.value).html;
  if (payload.mode === 'replace') {
    editor.value.commands.setContent(html);
    emit('update:modelValue', html);
    return;
  }
  if (payload.mode === 'append') {
    editor.value.commands.insertContentAt(editor.value.state.doc.content.size, html);
  } else {
    editor.value.commands.insertContent(html);
  }
}

function reportImageStatus(event: Event, loaded: boolean): void {
  if (!(event.target instanceof HTMLImageElement)) return;
  emit('imageStatus', {
    url: event.target.currentSrc || event.target.src,
    loaded,
    width: event.target.naturalWidth || Number(event.target.dataset.photobankWidth) || 1,
    height: event.target.naturalHeight || Number(event.target.dataset.photobankHeight) || 1
  });
}
</script>

<template>
  <div class="rounded-lg border">
    <div v-if="!editable" class="space-y-3 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant="warning">{{ t('products.descriptionEditor.readOnly') }}</Badge>
        <span class="text-sm font-medium">{{
          t(
            smartDetail
              ? 'products.descriptionEditor.smartDetail'
              : 'products.descriptionEditor.unsupportedHtml'
          )
        }}</span>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ t('products.descriptionEditor.conversionNotice') }}
      </p>
      <div
        class="flex w-fit rounded-md bg-muted p-1"
        role="tablist"
        :aria-label="t('products.descriptionEditor.sourceTabs')"
      >
        <button
          type="button"
          role="tab"
          class="rounded px-3 py-1.5 text-xs font-medium transition-colors"
          :class="readOnlyView === 'preview' ? 'bg-background shadow-sm' : 'text-muted-foreground'"
          :aria-selected="readOnlyView === 'preview'"
          @click="readOnlyView = 'preview'"
        >
          {{ t('products.descriptionEditor.safePreview') }}
        </button>
        <button
          type="button"
          role="tab"
          class="rounded px-3 py-1.5 text-xs font-medium transition-colors"
          :class="readOnlyView === 'source' ? 'bg-background shadow-sm' : 'text-muted-foreground'"
          :aria-selected="readOnlyView === 'source'"
          @click="readOnlyView = 'source'"
        >
          {{ t('products.descriptionEditor.originalHtml') }}
        </button>
      </div>
      <div
        v-if="readOnlyView === 'preview'"
        role="tabpanel"
        :aria-label="t('products.descriptionEditor.previewLabel')"
      >
        <EditorContent
          v-if="editor && inspection.html"
          :editor="editor"
          class="product-description-editor product-description-preview max-h-[32rem] overflow-auto rounded-md border bg-background p-4"
          @load.capture="reportImageStatus($event, true)"
          @error.capture="reportImageStatus($event, false)"
        />
        <p
          v-else-if="!inspection.html"
          class="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground"
        >
          {{ t('products.descriptionEditor.emptyPreview') }}
        </p>
        <p v-else class="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {{ t('products.descriptionEditor.preparingPreview') }}
        </p>
        <p class="mt-2 text-xs text-muted-foreground">
          {{ t('products.descriptionEditor.previewNotice') }}
          <span v-if="inspection.changes.length">
            {{ t('products.descriptionEditor.sanitizedChanges', { count: inspection.changes.length }) }}
          </span>
        </p>
      </div>
      <pre
        v-else
        role="tabpanel"
        :aria-label="t('products.descriptionEditor.sourceLabel')"
        class="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs text-slate-100"
        >{{ modelValue }}</pre>
      <Button variant="outline" size="sm" @click="reviewingConversion = true">
        <Braces class="size-4" />{{ t('products.descriptionEditor.reviewConversion') }}
      </Button>
      <div v-if="reviewingConversion" class="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        <p class="font-medium">{{ t('products.descriptionEditor.conversionChanges') }}</p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li v-for="(change, index) in conversionChanges" :key="`${change.target}:${index}`">
            {{ change.detail }}
          </li>
        </ul>
        <div class="mt-3 flex gap-2">
          <Button size="sm" @click="confirmConversion">
            {{ t('products.descriptionEditor.confirmConversion') }}
          </Button>
          <Button variant="ghost" size="sm" @click="reviewingConversion = false">
            {{ t('common.actions.cancel') }}
          </Button>
        </div>
      </div>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-1 border-b bg-muted/30 p-2">
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.bold')"
          @click="editor?.chain().focus().toggleBold().run()"
          ><Bold class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.italic')"
          @click="editor?.chain().focus().toggleItalic().run()"
          ><Italic class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.underline')"
          @click="editor?.chain().focus().toggleUnderline().run()"
          ><UnderlineIcon class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.heading2')"
          @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
          ><Heading2 class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.heading3')"
          @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
          ><Heading3 class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.heading4')"
          @click="editor?.chain().focus().toggleHeading({ level: 4 }).run()"
          ><Heading4 class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.bulletList')"
          @click="editor?.chain().focus().toggleBulletList().run()"
          ><List class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.orderedList')"
          @click="editor?.chain().focus().toggleOrderedList().run()"
          ><ListOrdered class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.quote')"
          @click="editor?.chain().focus().toggleBlockquote().run()"
          ><Quote class="size-4"
        /></Button>
        <Button
          size="icon"
          variant="ghost"
          :aria-label="t('products.descriptionEditor.toolbar.table')"
          @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()"
          ><Table2 class="size-4"
        /></Button>
        <div class="ml-1 flex min-w-56 flex-1 gap-1">
          <Input
            v-model="linkUrl"
            placeholder="https://…"
            :aria-label="t('products.descriptionEditor.toolbar.linkAddress')"
          />
          <Button
            variant="outline"
            size="icon"
            :aria-label="t('products.descriptionEditor.toolbar.setLink')"
            @click="setLink"
            ><LinkIcon class="size-4"
          /></Button>
        </div>
        <PhotoBankPicker
          :model-value="pickedPhotos"
          :max="1"
          :button-label="t('products.descriptionEditor.toolbar.insertGalleryImage')"
          @update:model-value="insertPhoto"
        />
        <ProductDescriptionTemplatePanel
          :language="language"
          :current-html="modelValue"
          @apply="applyTemplate"
        />
      </div>
      <EditorContent
        v-if="editor"
        :editor="editor"
        class="product-description-editor min-h-64 p-4"
        @load.capture="reportImageStatus($event, true)"
        @error.capture="reportImageStatus($event, false)"
      />
      <p class="border-t px-4 py-2 text-xs text-muted-foreground">
        {{ t('products.descriptionEditor.safeOutput') }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.product-description-editor :deep(.ProseMirror) {
  min-height: 14rem;
  outline: none;
}

.product-description-preview :deep(.ProseMirror) {
  min-height: 0;
}

.product-description-editor :deep(h2),
.product-description-editor :deep(h3),
.product-description-editor :deep(h4) {
  margin: 1rem 0 0.5rem;
  font-weight: 650;
}

.product-description-editor :deep(ul),
.product-description-editor :deep(ol) {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.product-description-editor :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.product-description-editor :deep(th),
.product-description-editor :deep(td) {
  border: 1px solid hsl(var(--border));
  padding: 0.5rem;
}

.product-description-editor :deep(img) {
  max-width: 100%;
}
</style>
