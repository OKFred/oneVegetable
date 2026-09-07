<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Download, FileArchive, LoaderCircle, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';

import {
  decodeBase64,
  encodeBase64,
  type GalleryTransferAssetV1,
  type GalleryTransferDocumentV1,
  type Photo
} from '@one-vegetable/core';

import ConfirmActionDialog from './ConfirmActionDialog.vue';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import { useUiI18n } from '../i18n';
import {
  createGalleryTransferArchive,
  galleryAssetSha256,
  galleryTransferAssetPath,
  readGalleryTransferArchive,
  type GalleryTransferArchive
} from '../lib/gallery-transfer-archive';
import { useServices } from '../lib/services';

type GalleryTransferMode = 'import' | 'export';

const props = withDefaults(
  defineProps<{
    open: boolean;
    mode: GalleryTransferMode;
    photos: readonly Photo[];
    targetGroupId: string;
    targetGroupName: string;
    uploadAllowed?: boolean;
    uploadDisabledReason?: string;
  }>(),
  { uploadAllowed: true, uploadDisabledReason: '' }
);
const emit = defineEmits<{
  'update:open': [open: boolean];
  imported: [count: number];
}>();
const { gateway } = useServices();
const { t } = useUiI18n();
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref('');
const selectedFileSize = ref(0);
const selectedArchive = ref<GalleryTransferArchive | null>(null);
const error = ref('');
const busy = ref(false);
const validating = ref(false);
const confirmOpen = ref(false);
const title = computed(() =>
  t(props.mode === 'export' ? 'photos.transfer.exportTitle' : 'photos.transfer.importTitle')
);
const canExecute = computed(() =>
  props.mode === 'export' ? props.photos.length > 0 : props.uploadAllowed && selectedArchive.value !== null
);

watch(
  () => props.open,
  (open) => {
    if (open) return;
    selectedFileName.value = '';
    selectedFileSize.value = 0;
    selectedArchive.value = null;
    error.value = '';
    validating.value = false;
    confirmOpen.value = false;
  }
);

function requestOpen(open: boolean): void {
  if (!open && !busy.value) emit('update:open', false);
}

async function selectFile(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  selectedFileName.value = file.name;
  selectedFileSize.value = file.size;
  selectedArchive.value = null;
  error.value = '';
  validating.value = true;
  try {
    selectedArchive.value = await readGalleryTransferArchive(new Uint8Array(await file.arrayBuffer()));
  } catch (reason: unknown) {
    error.value = message(reason);
  } finally {
    validating.value = false;
  }
}

async function execute(): Promise<void> {
  confirmOpen.value = false;
  if (!canExecute.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (props.mode === 'export') await exportPhotos();
    else await importPhotos();
    emit('update:open', false);
  } catch (reason: unknown) {
    error.value = message(reason);
  } finally {
    busy.value = false;
  }
}

async function exportPhotos(): Promise<void> {
  const archiveAssets: { path: string; bytes: Uint8Array }[] = [];
  const manifestAssets: GalleryTransferAssetV1[] = [];
  const usedPaths = new Set<string>();
  for (const photo of props.photos) {
    const downloaded = await gateway.request('downloadProductAsset', { url: photo.url });
    const bytes = decodeBase64(downloaded.contentBase64);
    const sha256 = downloaded.sha256 || (await galleryAssetSha256(bytes));
    let path = galleryTransferAssetPath(downloaded.fileName, downloaded.contentType, sha256);
    if (usedPaths.has(path.toLocaleLowerCase('en-US'))) {
      path = galleryTransferAssetPath(`${photo.id}-${downloaded.fileName}`, downloaded.contentType, sha256);
    }
    if (usedPaths.has(path.toLocaleLowerCase('en-US'))) {
      throw new Error(t('photos.transfer.errors.duplicatePhoto', { name: downloaded.fileName }));
    }
    usedPaths.add(path.toLocaleLowerCase('en-US'));
    archiveAssets.push({ path, bytes });
    manifestAssets.push({
      path,
      fileName: downloaded.fileName,
      sourcePhotoId: photo.id,
      groupPath: props.targetGroupName,
      contentType: downloaded.contentType,
      byteLength: downloaded.byteLength,
      sha256,
      width: photo.width,
      height: photo.height,
      modifiedTimeUtc: validTime(photo.modifiedAt)
    });
  }
  const document: GalleryTransferDocumentV1 = {
    schemaVersion: 1,
    kind: 'one-vegetable-gallery-transfer',
    createdTimeUtc: Date.now(),
    assets: manifestAssets
  };
  const archive = await createGalleryTransferArchive({
    document,
    assets: archiveAssets,
    totalUncompressedBytes: archiveAssets.reduce((total, asset) => total + asset.bytes.byteLength, 0)
  });
  download(`one-vegetable-gallery-${timestamp(new Date())}.zip`, archive);
  toast.success(t('photos.transfer.exported', { count: props.photos.length }));
}

async function importPhotos(): Promise<void> {
  const archive = selectedArchive.value;
  if (!archive) return;
  const metadataByPath = new Map(archive.document.assets.map((asset) => [asset.path, asset]));
  let imported = 0;
  for (const asset of archive.assets) {
    const metadata = metadataByPath.get(asset.path);
    if (!metadata) throw new Error(t('photos.transfer.errors.missingMetadata', { path: asset.path }));
    await gateway.request('uploadPhoto', {
      fileName: metadata.fileName,
      contentType: metadata.contentType,
      contentBase64: encodeBase64(asset.bytes),
      byteLength: asset.bytes.byteLength,
      groupId: props.targetGroupId
    });
    imported += 1;
  }
  emit('imported', imported);
  toast.success(t('photos.transfer.imported', { count: imported, group: props.targetGroupName }));
}

function download(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'application/zip' }));
  const anchor = globalThis.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function validTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function timestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z');
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="title"
    :description="
      t(mode === 'export' ? 'photos.transfer.exportDescription' : 'photos.transfer.importDescription', {
        count: photos.length,
        group: targetGroupName
      })
    "
    :dismissible="!busy"
    @update:open="requestOpen"
  >
    <div class="space-y-4">
      <div v-if="mode === 'export'" class="rounded-lg border bg-muted/30 p-4">
        <p class="font-medium">{{ t('photos.transfer.exportSummary', { count: photos.length }) }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('photos.transfer.archiveLimit') }}</p>
      </div>
      <template v-else>
        <div class="rounded-lg border border-dashed p-4">
          <Button variant="outline" :disabled="busy || validating" @click="fileInput?.click()">
            <Upload class="size-4" />{{ t('photos.transfer.chooseZip') }}
          </Button>
          <input
            ref="fileInput"
            class="sr-only"
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            :aria-label="t('photos.transfer.chooseZip')"
            @change="selectFile"
          />
          <p class="mt-2 text-xs text-muted-foreground">{{ t('photos.transfer.archiveLimit') }}</p>
        </div>
        <div v-if="selectedFileName" class="rounded-lg border bg-muted/30 p-4">
          <div class="flex items-start gap-3">
            <FileArchive class="mt-0.5 size-5 text-primary" />
            <div>
              <p class="break-all font-medium">{{ selectedFileName }}</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ formatBytes(selectedFileSize) }}
                <template v-if="selectedArchive">
                  · {{ t('photos.transfer.assetCount', { count: selectedArchive.document.assets.length }) }}
                </template>
              </p>
            </div>
          </div>
        </div>
        <p v-if="!uploadAllowed" class="text-sm text-amber-700 dark:text-amber-300">
          {{ uploadDisabledReason }}
        </p>
      </template>
      <p v-if="validating" class="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle class="size-4 animate-spin" />{{ t('photos.transfer.validating') }}
      </p>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="busy" @click="requestOpen(false)">{{
          t('common.actions.cancel')
        }}</Button>
        <Button :disabled="busy || !canExecute" @click="confirmOpen = true">
          <LoaderCircle v-if="busy" class="size-4 animate-spin" />
          <Download v-else-if="mode === 'export'" class="size-4" />
          <Upload v-else class="size-4" />
          {{
            t(
              busy
                ? 'common.actions.processing'
                : mode === 'export'
                  ? 'photos.transfer.exportAction'
                  : 'photos.transfer.importAction'
            )
          }}
        </Button>
      </div>
    </template>
  </ModalDialog>
  <ConfirmActionDialog
    v-model:open="confirmOpen"
    :title="t(mode === 'export' ? 'photos.transfer.confirmExport' : 'photos.transfer.confirmImport')"
    :description="
      t(
        mode === 'export'
          ? 'photos.transfer.confirmExportDescription'
          : 'photos.transfer.confirmImportDescription',
        {
          count: mode === 'export' ? photos.length : (selectedArchive?.document.assets.length ?? 0),
          group: targetGroupName
        }
      )
    "
    :confirm-label="t(mode === 'export' ? 'photos.transfer.exportAction' : 'photos.transfer.importAction')"
    @confirm="execute"
  />
</template>
