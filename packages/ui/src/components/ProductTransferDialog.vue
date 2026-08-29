<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronDown, FileJson, LoaderCircle, Upload } from '@lucide/vue';

import {
  MAX_PRODUCT_TRANSFER_JSON_BYTES,
  parseProductTransferJson,
  type Product,
  type ProductTransferDocumentV1,
  type ProductTransferSchemaFormat
} from '@one-vegetable/core';

import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';

type ProductTransferMode = 'import' | 'export';
type ConfirmationKind = 'execute' | 'close';

const props = defineProps<{
  open: boolean;
  mode: ProductTransferMode;
  busy: boolean;
  error: string;
  schemaFormat: ProductTransferSchemaFormat;
  exportProducts: readonly Product[];
}>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  'update:schemaFormat': [format: ProductTransferSchemaFormat];
  'confirm-import': [document: ProductTransferDocumentV1];
  'confirm-export': [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref('');
const selectedFileSize = ref(0);
const importDocument = ref<ProductTransferDocumentV1 | null>(null);
const importError = ref('');
const validatingFile = ref(false);
const confirmationKind = ref<ConfirmationKind | null>(null);
let validationSequence = 0;

const title = computed(() => (props.mode === 'import' ? '导入商品' : '导出商品'));
const description = computed(() =>
  props.mode === 'import'
    ? '选择商品 JSON 文件，校验通过并确认后才会写入本机批量发品队列。'
    : `本次将导出打开对话框时选中的 ${props.exportProducts.length} 个商品。`
);
const canExecute = computed(() =>
  props.mode === 'import'
    ? importDocument.value !== null && !validatingFile.value
    : props.exportProducts.length > 0
);
const visibleImportProducts = computed(() => (importDocument.value?.products ?? []).slice(0, 5));
const visibleExportProducts = computed(() => props.exportProducts.slice(0, 5));
const productCount = computed(() =>
  props.mode === 'import' ? (importDocument.value?.products.length ?? 0) : props.exportProducts.length
);

watch(
  () => props.open,
  (open) => {
    if (!open) resetDialog();
  }
);

function chooseFile(): void {
  fileInput.value?.click();
}

async function validateFile(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const sequence = ++validationSequence;
  selectedFileName.value = file.name;
  selectedFileSize.value = file.size;
  importDocument.value = null;
  importError.value = '';
  if (file.size > MAX_PRODUCT_TRANSFER_JSON_BYTES) {
    importError.value = '商品导入文件超过 10 MiB 上限。';
    return;
  }

  validatingFile.value = true;
  try {
    const document = parseProductTransferJson(await file.text());
    if (sequence !== validationSequence) return;
    importDocument.value = document;
  } catch (error: unknown) {
    if (sequence !== validationSequence) return;
    importError.value = errorMessage(error);
  } finally {
    if (sequence === validationSequence) validatingFile.value = false;
  }
}

function requestMainOpenChange(open: boolean): void {
  if (open || props.busy || confirmationKind.value !== null) return;
  confirmationKind.value = 'close';
}

function requestClose(): void {
  if (props.busy) return;
  confirmationKind.value = 'close';
}

function requestExecute(): void {
  if (props.busy || !canExecute.value) return;
  confirmationKind.value = 'execute';
}

function returnToMainDialog(): void {
  confirmationKind.value = null;
}

function confirmClose(): void {
  confirmationKind.value = null;
  resetDialog();
  emit('update:open', false);
}

function confirmExecute(): void {
  confirmationKind.value = null;
  if (props.mode === 'import') {
    if (importDocument.value) emit('confirm-import', importDocument.value);
    return;
  }
  emit('confirm-export');
}

function resetDialog(): void {
  validationSequence += 1;
  selectedFileName.value = '';
  selectedFileSize.value = 0;
  importDocument.value = null;
  importError.value = '';
  validatingFile.value = false;
  confirmationKind.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

function updateSchemaFormat(event: Event): void {
  const value = (event.currentTarget as HTMLInputElement).value;
  if (value === 'json' || value === 'xml') emit('update:schemaFormat', value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="title"
    :description="description"
    size="lg"
    @update:open="requestMainOpenChange"
  >
    <div class="space-y-5">
      <template v-if="mode === 'import'">
        <section class="rounded-lg border border-dashed p-4">
          <div class="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 class="font-medium">商品 JSON 文件</h3>
              <p class="mt-1 text-sm text-muted-foreground">
                支持 schemaJson、schemaXml，以及同时包含两个字段的历史文件；最大 10 MiB。
              </p>
            </div>
            <Button variant="outline" :disabled="busy || validatingFile" @click="chooseFile">
              <Upload class="size-4" />{{ selectedFileName ? '重新选择' : '选择文件' }}
            </Button>
          </div>
          <input
            ref="fileInput"
            class="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label="选择商品 JSON 文件"
            :disabled="busy || validatingFile"
            @change="validateFile"
          />
        </section>

        <section v-if="selectedFileName" class="rounded-lg border bg-muted/30 p-4" aria-label="导入文件预览">
          <div class="flex items-start gap-3">
            <FileJson class="mt-0.5 size-5 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <p class="break-all font-medium">{{ selectedFileName }}</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ formatBytes(selectedFileSize)
                }}<template v-if="importDocument"> · {{ productCount }} 个商品</template>
              </p>
              <p v-if="validatingFile" class="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle class="size-4 animate-spin" />正在校验文件与商品 Schema…
              </p>
              <ul v-else-if="importDocument" class="mt-3 space-y-1 text-sm">
                <li v-for="product in visibleImportProducts" :key="product.source.productId" class="truncate">
                  {{ product.source.subject }}
                </li>
                <li v-if="productCount > visibleImportProducts.length" class="text-muted-foreground">
                  另有 {{ productCount - visibleImportProducts.length }} 个商品
                </li>
              </ul>
            </div>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="rounded-lg border bg-muted/30 p-4" aria-label="导出商品预览">
          <div class="flex items-center justify-between gap-3">
            <h3 class="font-medium">已冻结本次导出范围</h3>
            <span class="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              {{ productCount }} 个商品
            </span>
          </div>
          <ul class="mt-3 space-y-1 text-sm">
            <li v-for="product in visibleExportProducts" :key="product.id" class="truncate">
              {{ product.subject }}
            </li>
            <li v-if="productCount > visibleExportProducts.length" class="text-muted-foreground">
              另有 {{ productCount - visibleExportProducts.length }} 个商品
            </li>
          </ul>
        </section>

        <details class="group rounded-lg border bg-background">
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>高级设置</span>
            <ChevronDown class="size-4 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <fieldset class="grid gap-3 border-t p-4 sm:grid-cols-2">
            <legend class="sr-only">导出字段</legend>
            <label
              class="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-foreground transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5 dark:has-[:checked]:bg-primary/10"
            >
              <input
                type="radio"
                name="product-transfer-schema-format"
                value="json"
                :checked="schemaFormat === 'json'"
                :disabled="busy"
                aria-label="Schema JSON"
                class="mt-1 accent-primary"
                @change="updateSchemaFormat"
              />
              <span>
                <span class="block font-medium">Schema JSON</span>
                <span class="mt-1 block text-xs text-muted-foreground"
                  >文件中仅包含 schemaJson，推荐使用。</span
                >
              </span>
            </label>
            <label
              class="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-foreground transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5 dark:has-[:checked]:bg-primary/10"
            >
              <input
                type="radio"
                name="product-transfer-schema-format"
                value="xml"
                :checked="schemaFormat === 'xml'"
                :disabled="busy"
                aria-label="Schema XML"
                class="mt-1 accent-primary"
                @change="updateSchemaFormat"
              />
              <span>
                <span class="block font-medium">Schema XML</span>
                <span class="mt-1 block text-xs text-muted-foreground"
                  >文件中仅包含 schemaXml，用于兼容旧工具。</span
                >
              </span>
            </label>
          </fieldset>
        </details>
      </template>

      <p v-if="importError" class="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        {{ importError }}
      </p>
      <p v-if="error" class="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        {{ error }}
      </p>
      <p v-if="busy" class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle class="size-4 animate-spin" />
        {{ mode === 'import' ? '正在写入本机批量发品队列…' : '正在读取商品 Schema 并生成 JSON…' }}
      </p>
    </div>

    <template #footer>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" :disabled="busy" @click="requestClose">取消</Button>
        <Button :disabled="busy || !canExecute" @click="requestExecute">
          <LoaderCircle v-if="busy" class="size-4 animate-spin" />
          {{ busy ? '处理中…' : mode === 'import' ? '导入' : '导出' }}
        </Button>
      </div>
    </template>
  </ModalDialog>

  <ModalDialog
    :open="confirmationKind !== null"
    :title="confirmationKind === 'execute' ? `确认${mode === 'import' ? '导入' : '导出'}` : '确认关闭'"
    :description="
      confirmationKind === 'execute'
        ? mode === 'import'
          ? `确认将 ${productCount} 个商品写入本机批量发品队列吗？不会直接写入平台。`
          : `确认读取 ${productCount} 个商品的 Schema 并下载 JSON 文件吗？`
        : '当前内容将被清空，确定关闭吗？'
    "
    size="sm"
    @update:open="returnToMainDialog"
  >
    <p class="text-sm text-muted-foreground">
      {{
        confirmationKind === 'execute'
          ? mode === 'import'
            ? '确认前不会写入本机队列。'
            : '确认前不会调用商品 Schema 接口或触发下载。'
          : '返回可继续当前操作；确认关闭后需要重新选择。'
      }}
    </p>
    <template #footer>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" @click="returnToMainDialog">返回</Button>
        <Button
          :variant="confirmationKind === 'close' ? 'destructive' : 'default'"
          @click="confirmationKind === 'close' ? confirmClose() : confirmExecute()"
        >
          {{ confirmationKind === 'close' ? '确认关闭' : `确认${mode === 'import' ? '导入' : '导出'}` }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
