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
  isProductTransferZipBytes,
  readProductTransferArchive,
  type ProductTransferFileFormat,
  type ProductTransferImportSelection,
  type ProductTransferProgress
} from '../lib/product-transfer-archive';
import { useUiI18n } from '../i18n';

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
const { t } = useUiI18n();

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref('');
const selectedFileSize = ref(0);
const importSelection = ref<ProductTransferImportSelection | null>(null);
const importError = ref('');
const validatingFile = ref(false);
const targetGroupId = ref('-1');
const targetGroupName = ref(t('products.transfer.galleryRoot'));
const confirmationKind = ref<ConfirmationKind | null>(null);
let validationSequence = 0;

const title = computed(() =>
  t(props.mode === 'import' ? 'products.transfer.importTitle' : 'products.transfer.exportTitle')
);
const description = computed(() =>
  props.mode === 'import'
    ? t('products.transfer.importDescription')
    : t('products.transfer.exportDescription', { count: props.exportProducts.length })
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
  targetGroupName.value = t('products.transfer.galleryRoot');
  validatingFile.value = true;
  try {
    const extension = file.name.split('.').pop()?.toLocaleLowerCase();
    const bytes = await readFileBytes(file);
    const isZip =
      extension === 'zip' ||
      file.type === 'application/zip' ||
      file.type === 'application/x-zip-compressed' ||
      isProductTransferZipBytes(bytes);
    if (isZip) {
      if (file.size > MAX_PRODUCT_TRANSFER_ZIP_BYTES) {
        throw new Error(t('products.transfer.errors.zipTooLarge'));
      }
      const archive = await readProductTransferArchive(bytes);
      if (sequence !== validationSequence) return;
      importSelection.value = {
        kind: 'zip',
        archive,
        targetGroupId: targetGroupId.value,
        targetGroupName: targetGroupName.value
      };
      return;
    }
    if (file.size > MAX_PRODUCT_TRANSFER_JSON_BYTES) {
      throw new Error(t('products.transfer.errors.jsonTooLarge'));
    }
    const text = decodeProductTransferText(bytes);
    if (extension !== 'json' && file.type !== 'application/json' && !text.trimStart().startsWith('{')) {
      throw new Error(t('products.transfer.errors.unsupportedFile'));
    }
    const document = parseProductTransferJson(text);
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
  targetGroupName.value = group.id === '-1' ? t('products.transfer.galleryRoot') : group.name;
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
  targetGroupName.value = t('products.transfer.galleryRoot');
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
      reject(new Error(t('products.transfer.errors.readFailed')));
    };
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error(t('products.transfer.errors.readFailed')));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });
}

function decodeProductTransferText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(t('products.transfer.errors.invalidUtf8'));
  }
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
              <h3 class="font-medium">{{ t('products.transfer.fileTitle') }}</h3>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ t('products.transfer.fileLimits') }}
              </p>
            </div>
            <Button variant="outline" :disabled="busy || validatingFile" @click="chooseFile">
              <Upload class="size-4" />{{
                t(selectedFileName ? 'products.transfer.reselect' : 'products.transfer.choose')
              }}
            </Button>
          </div>
          <input
            ref="fileInput"
            class="sr-only"
            type="file"
            accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
            :aria-label="t('products.transfer.chooseLabel')"
            :disabled="busy || validatingFile"
            @change="validateFile"
          />
        </section>

        <section
          v-if="selectedFileName"
          class="rounded-lg border bg-muted/30 p-4"
          :aria-label="t('products.transfer.importPreview')"
        >
          <div class="flex items-start gap-3">
            <FileArchive v-if="zipImport" class="mt-0.5 size-5 shrink-0 text-primary" />
            <FileJson v-else class="mt-0.5 size-5 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <p class="break-all font-medium">{{ selectedFileName }}</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ formatBytes(selectedFileSize)
                }}<template v-if="importDocument">
                  · {{ t('products.transfer.productCount', { count: productCount }) }}</template
                >
                <template v-if="zipImport">
                  · {{ t('products.transfer.imageCount', { count: zipAssetCount }) }}</template
                >
              </p>
              <p v-if="validatingFile" class="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle class="size-4 animate-spin" />{{ t('products.transfer.validating') }}
              </p>
              <ul v-else-if="importDocument" class="mt-3 space-y-1 text-sm">
                <li v-for="product in visibleImportProducts" :key="product.source.productId" class="truncate">
                  {{ product.source.subject }}
                </li>
                <li v-if="productCount > visibleImportProducts.length" class="text-muted-foreground">
                  {{
                    t('products.transfer.remainingProducts', {
                      count: productCount - visibleImportProducts.length
                    })
                  }}
                </li>
              </ul>
              <p
                v-if="zipImport?.unusedAssetPaths.length"
                class="mt-3 text-xs text-amber-700 dark:text-amber-300"
              >
                {{ t('products.transfer.unusedAssets', { count: zipImport.unusedAssetPaths.length }) }}
              </p>
            </div>
          </div>
        </section>

        <section v-if="zipImport && zipAssetCount > 0" class="rounded-lg border p-4">
          <div class="mb-3">
            <h3 class="font-medium">{{ t('products.transfer.uploadGroupTitle') }}</h3>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ t('products.transfer.uploadGroupDescription', { count: zipAssetCount }) }}
            </p>
          </div>
          <div class="max-h-52 overflow-auto rounded-md border bg-background p-1">
            <PhotoGroupNavigation
              v-model="targetGroupId"
              :all-label="t('products.transfer.galleryRoot')"
              @select="selectTargetGroup"
            />
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            {{ t('products.transfer.currentTarget', { name: targetGroupName }) }}
          </p>
          <p
            v-if="!assetUploadAllowed"
            class="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {{ assetUploadDisabledReason || t('products.transfer.uploadUnavailable') }}
          </p>
        </section>
      </template>

      <template v-else>
        <section class="rounded-lg border bg-muted/30 p-4" :aria-label="t('products.transfer.exportPreview')">
          <div class="flex items-center justify-between gap-3">
            <h3 class="font-medium">{{ t('products.transfer.frozen') }}</h3>
            <span class="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              {{ t('products.transfer.productCount', { count: productCount }) }}
            </span>
          </div>
          <ul class="mt-3 space-y-1 text-sm">
            <li v-for="product in visibleExportProducts" :key="product.id" class="truncate">
              {{ product.subject }}
            </li>
            <li v-if="productCount > visibleExportProducts.length" class="text-muted-foreground">
              {{
                t('products.transfer.remainingProducts', {
                  count: productCount - visibleExportProducts.length
                })
              }}
            </li>
          </ul>
        </section>

        <details class="group rounded-lg border bg-background">
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>{{ t('products.transfer.advanced') }}</span>
            <ChevronDown class="size-4 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div class="space-y-5 border-t p-4">
            <fieldset class="grid gap-3 sm:grid-cols-2">
              <legend class="mb-2 text-sm font-medium">{{ t('products.transfer.fileFormat') }}</legend>
              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-foreground transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5 dark:has-[:checked]:bg-primary/10"
              >
                <input
                  type="radio"
                  name="product-transfer-file-format"
                  value="json"
                  :checked="fileFormat === 'json'"
                  :disabled="busy"
                  :aria-label="t('products.transfer.jsonFile')"
                  class="mt-1 accent-primary"
                  @change="updateFileFormat"
                />
                <span
                  ><span class="block font-medium">JSON</span
                  ><span class="mt-1 block text-xs text-muted-foreground">{{
                    t('products.transfer.jsonDescription')
                  }}</span></span
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
                  :aria-label="t('products.transfer.zipFile')"
                  class="mt-1 accent-primary"
                  @change="updateFileFormat"
                />
                <span>
                  <span class="block font-medium">{{ t('products.transfer.zipTitle') }}</span>
                  <span class="mt-1 block text-xs text-muted-foreground">{{
                    t('products.transfer.zipDescription')
                  }}</span>
                </span>
              </label>
              <p
                v-if="fileFormat === 'zip' && !assetDownloadAllowed"
                class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2 dark:bg-amber-950/40 dark:text-amber-200"
              >
                {{ assetDownloadDisabledReason || t('products.transfer.downloadUnavailable') }}
              </p>
            </fieldset>
            <fieldset class="grid gap-3 sm:grid-cols-2">
              <legend class="mb-2 text-sm font-medium">{{ t('products.transfer.schemaField') }}</legend>
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
                  <span class="mt-1 block text-xs text-muted-foreground">{{
                    t('products.transfer.schemaJsonDescription')
                  }}</span>
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
                  <span class="mt-1 block text-xs text-muted-foreground">{{
                    t('products.transfer.schemaXmlDescription')
                  }}</span>
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
            t(mode === 'import' ? 'products.transfer.processingImport' : 'products.transfer.processingExport')
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
        <Button variant="outline" :disabled="busy" @click="requestClose">
          {{ t('common.actions.cancel') }}
        </Button>
        <Button :disabled="busy || !canExecute" @click="requestExecute">
          <LoaderCircle v-if="busy" class="size-4 animate-spin" />
          {{
            t(
              busy
                ? 'products.transfer.processing'
                : mode === 'import'
                  ? 'products.transfer.import'
                  : 'products.transfer.export'
            )
          }}
        </Button>
      </div>
    </template>
  </ModalDialog>

  <ModalDialog
    :open="confirmationKind !== null"
    :title="
      t(
        confirmationKind === 'execute'
          ? mode === 'import'
            ? 'products.transfer.confirmImport'
            : 'products.transfer.confirmExport'
          : 'products.transfer.confirmClose'
      )
    "
    :description="
      confirmationKind === 'execute'
        ? mode === 'import'
          ? importRequiresUpload
            ? t('products.transfer.confirmUpload', {
                images: zipAssetCount,
                products: productCount
              })
            : t('products.transfer.confirmQueue', { count: productCount })
          : fileFormat === 'zip'
            ? t('products.transfer.confirmZip', { count: productCount })
            : t('products.transfer.confirmJson', { count: productCount })
        : t('products.transfer.confirmCloseDescription')
    "
    size="sm"
    @update:open="returnToMainDialog"
  >
    <p class="text-sm text-muted-foreground">
      {{
        confirmationKind === 'execute'
          ? mode === 'import'
            ? importRequiresUpload
              ? t('products.transfer.uploadCaveat')
              : t('products.transfer.queueCaveat')
            : t('products.transfer.exportCaveat')
          : t('products.transfer.closeCaveat')
      }}
    </p>
    <template #footer>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" @click="returnToMainDialog">{{ t('products.transfer.back') }}</Button>
        <Button
          :variant="confirmationKind === 'close' ? 'destructive' : 'default'"
          @click="confirmationKind === 'close' ? confirmClose() : confirmExecute()"
        >
          {{
            t(
              confirmationKind === 'close'
                ? 'products.transfer.confirmClose'
                : mode === 'import'
                  ? 'products.transfer.confirmImport'
                  : 'products.transfer.confirmExport'
            )
          }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
