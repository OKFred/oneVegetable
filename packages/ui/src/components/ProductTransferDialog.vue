<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronDown, FileArchive, FileJson, LoaderCircle, Upload } from '@lucide/vue';

import {
  MAX_PRODUCT_TRANSFER_JSON_BYTES,
  MAX_PRODUCT_TRANSFER_ZIP_BYTES,
  parseProductTransferJson,
  type PhotoGroup,
  type Product,
  type ProductTransferSchemaFormat
} from '@one-vegetable/core';

import PhotoGroupNavigation from './PhotoGroupNavigation.vue';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import {
  readProductTransferArchive,
  type ProductTransferFileFormat,
  type ProductTransferImportSelection,
  type ProductTransferProgress
} from '../lib/product-transfer-archive';

type ProductTransferMode = 'import' | 'export';
type ConfirmationKind = 'execute' | 'close';

const props = withDefaults(
  defineProps<{
    open: boolean;
    mode: ProductTransferMode;
    busy: boolean;
    error: string;
    schemaFormat: ProductTransferSchemaFormat;
    fileFormat: ProductTransferFileFormat;
    exportProducts: readonly Product[];
    assetUploadAllowed?: boolean;
    assetUploadDisabledReason?: string;
    assetDownloadAllowed?: boolean;
    assetDownloadDisabledReason?: string;
    progress?: ProductTransferProgress | null;
  }>(),
  {
    assetUploadAllowed: true,
    assetUploadDisabledReason: '',
    assetDownloadAllowed: true,
    assetDownloadDisabledReason: '',
    progress: null
  }
);
const emit = defineEmits<{
  'update:open': [open: boolean];
  'update:schemaFormat': [format: ProductTransferSchemaFormat];
  'update:fileFormat': [format: ProductTransferFileFormat];
  'confirm-import': [selection: ProductTransferImportSelection];
  'confirm-export': [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref('');
const selectedFileSize = ref(0);
const importSelection = ref<ProductTransferImportSelection | null>(null);
const importError = ref('');
const validatingFile = ref(false);
const targetGroupId = ref('-1');
const targetGroupName = ref('图库根目录');
const confirmationKind = ref<ConfirmationKind | null>(null);
let validationSequence = 0;

const title = computed(() => (props.mode === 'import' ? '导入商品' : '导出商品'));
const description = computed(() =>
  props.mode === 'import'
    ? '支持 JSON，或包含 products.json 与 assets/ 图片的 ZIP。确认前只做本地校验。'
    : `本次将导出打开对话框时选中的 ${props.exportProducts.length} 个商品。`
);
const importDocument = computed(() =>
  importSelection.value?.kind === 'json'
    ? importSelection.value.document
    : importSelection.value?.archive.document
);
const zipImport = computed(() =>
  importSelection.value?.kind === 'zip' ? importSelection.value.archive : null
);
const zipAssetCount = computed(() => zipImport.value?.referencedAssetPaths.length ?? 0);
const importRequiresUpload = computed(() => zipAssetCount.value > 0);
const canExecute = computed(() =>
  props.mode === 'import'
    ? importSelection.value !== null &&
      !validatingFile.value &&
      (!importRequiresUpload.value || props.assetUploadAllowed)
    : props.exportProducts.length > 0 && (props.fileFormat !== 'zip' || props.assetDownloadAllowed)
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
  importSelection.value = null;
  importError.value = '';
  targetGroupId.value = '-1';
  targetGroupName.value = '图库根目录';
  validatingFile.value = true;
  try {
    const extension = file.name.split('.').pop()?.toLocaleLowerCase();
    if (extension === 'zip') {
      if (file.size > MAX_PRODUCT_TRANSFER_ZIP_BYTES) throw new Error('商品 ZIP 超过 50 MiB 上限');
      const archive = await readProductTransferArchive(await readFileBytes(file));
      if (sequence !== validationSequence) return;
      importSelection.value = {
        kind: 'zip',
        archive,
        targetGroupId: targetGroupId.value,
        targetGroupName: targetGroupName.value
      };
      return;
    }
    if (extension !== 'json') throw new Error('仅支持 .json 或 .zip 商品文件');
    if (file.size > MAX_PRODUCT_TRANSFER_JSON_BYTES) throw new Error('商品导入文件超过 10 MiB 上限');
    const document = parseProductTransferJson(await readFileText(file));
    if (sequence !== validationSequence) return;
    importSelection.value = { kind: 'json', document };
  } catch (error: unknown) {
    if (sequence !== validationSequence) return;
    importError.value = errorMessage(error);
  } finally {
    if (sequence === validationSequence) validatingFile.value = false;
  }
}

function selectTargetGroup(group: PhotoGroup): void {
  targetGroupId.value = group.id;
  targetGroupName.value = group.id === '-1' ? '图库根目录' : group.name;
  if (importSelection.value?.kind !== 'zip') return;
  importSelection.value = {
    ...importSelection.value,
    targetGroupId: targetGroupId.value,
    targetGroupName: targetGroupName.value
  };
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
    if (!importSelection.value) return;
    if (importSelection.value.kind === 'zip') {
      emit('confirm-import', {
        ...importSelection.value,
        targetGroupId: targetGroupId.value,
        targetGroupName: targetGroupName.value
      });
    } else {
      emit('confirm-import', importSelection.value);
    }
    return;
  }
  emit('confirm-export');
}

function resetDialog(): void {
  validationSequence += 1;
  selectedFileName.value = '';
  selectedFileSize.value = 0;
  importSelection.value = null;
  importError.value = '';
  validatingFile.value = false;
  targetGroupId.value = '-1';
  targetGroupName.value = '图库根目录';
  confirmationKind.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

function updateSchemaFormat(event: Event): void {
  const value = (event.currentTarget as HTMLInputElement).value;
  if (value === 'json' || value === 'xml') emit('update:schemaFormat', value);
}

function updateFileFormat(event: Event): void {
  const value = (event.currentTarget as HTMLInputElement).value;
  if (value === 'json' || value === 'zip') emit('update:fileFormat', value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error('读取商品文件失败'));
    };
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('读取商品文件失败'));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error('读取商品文件失败'));
    };
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('读取商品文件失败'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsText(file, 'utf-8');
  });
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
              <h3 class="font-medium">商品文件</h3>
              <p class="mt-1 text-sm text-muted-foreground">
                JSON 最大 10 MiB；ZIP 最大 50 MiB、解压后最大 100 MiB，图片位于 assets/。
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
            accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
            aria-label="选择商品 JSON 或 ZIP 文件"
            :disabled="busy || validatingFile"
            @change="validateFile"
          />
        </section>

        <section v-if="selectedFileName" class="rounded-lg border bg-muted/30 p-4" aria-label="导入文件预览">
          <div class="flex items-start gap-3">
            <FileArchive v-if="zipImport" class="mt-0.5 size-5 shrink-0 text-primary" />
            <FileJson v-else class="mt-0.5 size-5 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <p class="break-all font-medium">{{ selectedFileName }}</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ formatBytes(selectedFileSize)
                }}<template v-if="importDocument"> · {{ productCount }} 个商品</template>
                <template v-if="zipImport"> · {{ zipAssetCount }} 张引用图片</template>
              </p>
              <p v-if="validatingFile" class="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle class="size-4 animate-spin" />正在安全解压并校验商品与图片…
              </p>
              <ul v-else-if="importDocument" class="mt-3 space-y-1 text-sm">
                <li v-for="product in visibleImportProducts" :key="product.source.productId" class="truncate">
                  {{ product.source.subject }}
                </li>
                <li v-if="productCount > visibleImportProducts.length" class="text-muted-foreground">
                  另有 {{ productCount - visibleImportProducts.length }} 个商品
                </li>
              </ul>
              <p
                v-if="zipImport?.unusedAssetPaths.length"
                class="mt-3 text-xs text-amber-700 dark:text-amber-300"
              >
                ZIP 中有 {{ zipImport.unusedAssetPaths.length }} 张未被商品引用的图片，将不会上传。
              </p>
            </div>
          </div>
        </section>

        <section v-if="zipImport && zipAssetCount > 0" class="rounded-lg border p-4">
          <div class="mb-3">
            <h3 class="font-medium">上传到图库分组</h3>
            <p class="mt-1 text-sm text-muted-foreground">
              确认导入后先上传 {{ zipAssetCount }} 张图片；全部成功后才写入批量发品队列。
            </p>
          </div>
          <div class="max-h-52 overflow-auto rounded-md border bg-background p-1">
            <PhotoGroupNavigation
              v-model="targetGroupId"
              all-label="图库根目录"
              @select="selectTargetGroup"
            />
          </div>
          <p class="mt-2 text-xs text-muted-foreground">当前目标：{{ targetGroupName }}</p>
          <p
            v-if="!assetUploadAllowed"
            class="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {{ assetUploadDisabledReason || '当前环境未开放真实图库上传，不能导入含本地图片的 ZIP。' }}
          </p>
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
          <div class="space-y-5 border-t p-4">
            <fieldset class="grid gap-3 sm:grid-cols-2">
              <legend class="mb-2 text-sm font-medium">文件格式</legend>
              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-foreground transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5 dark:has-[:checked]:bg-primary/10"
              >
                <input
                  type="radio"
                  name="product-transfer-file-format"
                  value="json"
                  :checked="fileFormat === 'json'"
                  :disabled="busy"
                  aria-label="JSON 文件"
                  class="mt-1 accent-primary"
                  @change="updateFileFormat"
                />
                <span
                  ><span class="block font-medium">JSON</span
                  ><span class="mt-1 block text-xs text-muted-foreground">仅导出商品数据。</span></span
                >
              </label>
              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-foreground transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5 dark:has-[:checked]:bg-primary/10"
              >
                <input
                  type="radio"
                  name="product-transfer-file-format"
                  value="zip"
                  :checked="fileFormat === 'zip'"
                  :disabled="busy"
                  aria-label="ZIP 资源包"
                  class="mt-1 accent-primary"
                  @change="updateFileFormat"
                />
                <span>
                  <span class="block font-medium">ZIP（含图片）</span>
                  <span class="mt-1 block text-xs text-muted-foreground"
                    >下载图库图片到 assets/，任一图片失败则不生成文件。</span
                  >
                </span>
              </label>
              <p
                v-if="fileFormat === 'zip' && !assetDownloadAllowed"
                class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2 dark:bg-amber-950/40 dark:text-amber-200"
              >
                {{ assetDownloadDisabledReason || '当前环境未开放商品图片下载，不能生成 ZIP。' }}
              </p>
            </fieldset>
            <fieldset class="grid gap-3 sm:grid-cols-2">
              <legend class="mb-2 text-sm font-medium">Schema 字段</legend>
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
                    >products.json 中仅包含 schemaJson，推荐使用。</span
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
                    >products.json 中仅包含 schemaXml，用于兼容旧工具。</span
                  >
                </span>
              </label>
            </fieldset>
          </div>
        </details>
      </template>

      <p v-if="importError" class="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        {{ importError }}
      </p>
      <p v-if="error" class="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        {{ error }}
      </p>
      <div v-if="busy" class="space-y-2" role="status">
        <p class="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle class="size-4 animate-spin" />
          {{
            progress?.message ||
            (mode === 'import' ? '正在处理商品与图片…' : '正在读取商品 Schema 并生成文件…')
          }}
        </p>
        <div v-if="progress && progress.total > 0" class="h-2 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-200"
            :style="{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }"
          />
        </div>
      </div>
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
          ? importRequiresUpload
            ? `确认上传 ${zipAssetCount} 张图片，并在全部成功后将 ${productCount} 个商品写入本机队列吗？`
            : `确认将 ${productCount} 个商品写入本机批量发品队列吗？不会直接写入平台。`
          : fileFormat === 'zip'
            ? `确认下载商品引用的图库图片并生成 ${productCount} 个商品的 ZIP 吗？`
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
            ? importRequiresUpload
              ? '图片上传失败时不会写入本机队列；已经上传成功的图库图片不会自动删除。'
              : '确认前不会写入本机队列。'
            : '确认前不会调用商品 Schema 或图片下载接口，也不会触发文件下载。'
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
