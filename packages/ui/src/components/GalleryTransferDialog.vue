<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Cloud, Download, FileArchive, LoaderCircle, RefreshCw, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';

import {
  decodeBase64,
  encodeBase64,
  evaluateGalleryImportRules,
  type GalleryTransferAssetV1,
  type GalleryTransferDocumentV1,
  type GalleryImportDecision,
  type Photo,
  type PhotoGroup
} from '@one-vegetable/core';

import ConfirmActionDialog from './ConfirmActionDialog.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
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
import { loadGalleryImportRuleSet } from '../lib/gallery-import-rules-storage';

type GalleryTransferMode = 'import' | 'export';
type GalleryTransferStorage = 'zip' | 's3';

interface S3ImportDecision extends GalleryImportDecision {
  etag: string | null;
}

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
const { gateway, control } = useServices();
const { t } = useUiI18n();
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref('');
const selectedFileSize = ref(0);
const selectedArchive = ref<GalleryTransferArchive | null>(null);
const error = ref('');
const busy = ref(false);
const validating = ref(false);
const confirmOpen = ref(false);
const storage = ref<GalleryTransferStorage>('zip');
const s3Decisions = ref<S3ImportDecision[]>([]);
const s3Scanning = ref(false);
const importMapping = ref<'rules' | 'current'>('rules');
const createMissingGroups = ref(true);
const exportMapping = ref<'flat' | 'groups'>('flat');
const exportPrefix = ref('exports');
const importResult = ref('');
watch(importMapping, () => {
  s3Decisions.value = [];
});

const s3Supported = computed(
  () =>
    control?.listS3Objects !== undefined &&
    control.getS3Object !== undefined &&
    control.putS3Object !== undefined
);
const s3ImportCount = computed(() => s3Decisions.value.filter((item) => item.action === 'import').length);
const canExecute = computed(() => {
  if (props.mode === 'export')
    return props.photos.length > 0 && (storage.value === 'zip' || s3Supported.value);
  if (!props.uploadAllowed) return false;
  return storage.value === 'zip' ? selectedArchive.value !== null : s3ImportCount.value > 0;
});
const title = computed(() =>
  t(props.mode === 'export' ? 'photos.transfer.exportTitle' : 'photos.transfer.importTitle')
);

watch(
  () => props.open,
  (open) => {
    if (!open) reset();
  }
);

function requestOpen(open: boolean): void {
  if (!open && !busy.value) emit('update:open', false);
}

function chooseFile(): void {
  fileInput.value?.click();
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
  if (busy.value || !canExecute.value) return;
  busy.value = true;
  error.value = '';
  importResult.value = '';
  try {
    if (props.mode === 'export') {
      if (storage.value === 's3') await exportPhotosToS3();
      else await exportPhotos();
    } else if (storage.value === 's3') await importPhotosFromS3();
    else await importPhotos();
    if (!importResult.value) emit('update:open', false);
  } catch (reason: unknown) {
    error.value = message(reason);
  } finally {
    busy.value = false;
  }
}

async function scanS3(): Promise<void> {
  if (!control?.listS3Objects) return;
  s3Scanning.value = true;
  error.value = '';
  try {
    const objects = [];
    let continuationToken: string | undefined;
    do {
      const page = await control.listS3Objects({
        maximum: Math.min(500 - objects.length, 500),
        ...(continuationToken ? { continuationToken } : {})
      });
      objects.push(...page.items);
      continuationToken = page.nextContinuationToken ?? undefined;
    } while (continuationToken && objects.length < 500);
    const candidates = objects
      .map((object) => ({ ...object, contentType: imageContentType(object.key) }))
      .filter((object) => object.contentType !== null);
    s3Decisions.value = evaluateGalleryImportRules(
      candidates.map((object) => ({
        sourcePath: object.key,
        fileName: fileNameFromPath(object.key),
        byteLength: object.size,
        contentType: object.contentType
      })),
      importMapping.value === 'rules'
        ? loadGalleryImportRuleSet()
        : {
            schemaVersion: 1,
            conflictPolicy: loadGalleryImportRuleSet().conflictPolicy,
            rules: [
              {
                id: 'current',
                name: 'Current',
                enabled: true,
                sourcePrefix: '',
                includeGlob: '**',
                excludeGlobs: [],
                targetGroupPath: props.targetGroupName
              }
            ]
          }
    ).map((decision) => ({
      ...decision,
      etag: candidates.find((object) => object.key === decision.sourcePath)?.etag ?? null
    }));
  } catch (reason: unknown) {
    error.value = message(reason);
    s3Decisions.value = [];
  } finally {
    s3Scanning.value = false;
  }
}

async function exportPhotos(): Promise<void> {
  const assets: { path: string; bytes: Uint8Array }[] = [];
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
    assets.push({ path, bytes });
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
    assets,
    totalUncompressedBytes: assets.reduce((total, asset) => total + asset.bytes.byteLength, 0)
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

async function exportPhotosToS3(): Promise<void> {
  if (!control?.putS3Object) return;
  const base = exportPrefix.value.trim().replace(/\/$/u, '');
  if (
    base &&
    (base.startsWith('/') ||
      base.includes('\\') ||
      base.split('/').some((part) => !part || part === '.' || part === '..') ||
      /\p{Cc}/u.test(base))
  )
    throw new Error(t('photos.transfer.invalidPrefix'));
  const prefix = [base, `${timestamp(new Date())}-${globalThis.crypto.randomUUID().slice(0, 8)}`]
    .filter(Boolean)
    .join('/');
  const groupPaths = await loadPhotoGroupPaths(true);
  const pathsById = new Map([...groupPaths].map(([path, id]) => [id, path]));
  const assets: GalleryTransferAssetV1[] = [];
  for (const photo of props.photos) {
    const downloaded = await gateway.request('downloadProductAsset', { url: photo.url });
    const bytes = decodeBase64(downloaded.contentBase64);
    const sha256 = downloaded.sha256 || (await galleryAssetSha256(bytes));
    const groupPath = pathsById.get(photo.groupId) ?? (photo.groupId === '-1' ? 'Ungrouped' : photo.groupId);
    const leaf = galleryTransferAssetPath(
      `${photo.id}-${downloaded.fileName}`,
      downloaded.contentType,
      sha256
    ).slice('assets/'.length);
    const relativePath =
      exportMapping.value === 'groups'
        ? `assets/${groupPath
            .split('/')
            .map((part) => encodeURIComponent(part))
            .join('/')}/${leaf}`
        : `assets/${leaf}`;
    await control.putS3Object({
      key: `${prefix}/${relativePath}`,
      bytes,
      contentType: downloaded.contentType
    });
    assets.push({
      path: relativePath,
      fileName: downloaded.fileName,
      sourcePhotoId: photo.id,
      groupPath,
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
    assets
  };
  await control.putS3Object({
    key: `${prefix}/gallery.json`,
    bytes: new TextEncoder().encode(JSON.stringify(document, null, 2)),
    contentType: 'application/json'
  });
  toast.success(t('photos.transfer.s3Exported', { count: props.photos.length, prefix }));
}

async function importPhotosFromS3(): Promise<void> {
  if (!control?.getS3Object) return;
  const groupIds = await loadPhotoGroupPaths();
  const namesByGroup = new Map<string, Set<string>>();
  const ruleSet = loadGalleryImportRuleSet();
  let imported = 0;
  const outcomes: string[] = [];
  const plan = s3Decisions.value.filter((item) => item.action === 'import');
  // Validate the complete plan before creating any remote group.
  for (const item of plan) {
    const parts = item.targetGroupPath?.split('/') ?? [];
    if (
      !parts.length ||
      parts.length > 3 ||
      parts.some((part) => !part.trim() || part === '.' || part === '..')
    )
      throw new Error(t('photos.transfer.invalidGroupPath'));
    if (
      !createMissingGroups.value &&
      (!item.targetGroupPath || !groupIds.has(item.targetGroupPath.toLocaleLowerCase()))
    )
      throw new Error(t('photos.transfer.errors.groupMissing', { group: item.targetGroupPath ?? '' }));
  }
  for (const item of plan) {
    let parentId: string | undefined;
    let path = '';
    for (const name of (item.targetGroupPath ?? '').split('/')) {
      path = path ? `${path}/${name}` : name;
      const key = path.toLocaleLowerCase();
      let id = groupIds.get(key);
      if (!id) {
        const created = await gateway.request('operatePhotoGroup', {
          operation: 'add',
          groupName: name,
          groupId: parentId ?? null
        });
        if (!created.groupId) throw new Error(t('photos.transfer.errors.groupMissing', { group: path }));
        id = created.groupId;
        groupIds.set(key, id);
      }
      parentId = id;
    }
  }
  for (const decision of plan) {
    if (decision.action !== 'import' || !decision.targetGroupPath || !decision.contentType) continue;
    const groupId = groupIds.get(decision.targetGroupPath.toLocaleLowerCase());
    if (!groupId)
      throw new Error(t('photos.transfer.errors.groupMissing', { group: decision.targetGroupPath }));
    const names = namesByGroup.get(groupId) ?? (await loadPhotoNames(groupId));
    namesByGroup.set(groupId, names);
    let fileName = decision.fileName;
    if (names.has(fileName.toLocaleLowerCase())) {
      if (ruleSet.conflictPolicy === 'skip') continue;
      fileName = renamedFileName(fileName);
    }
    const object = await control.getS3Object(decision.sourcePath);
    const uploaded = await gateway.request('uploadPhoto', {
      fileName,
      contentType: object.contentType ?? decision.contentType,
      contentBase64: encodeBase64(object.bytes),
      byteLength: object.bytes.byteLength,
      groupId
    });
    names.add(fileName.toLocaleLowerCase());
    imported += 1;
    s3Decisions.value = s3Decisions.value.filter((item) => item.sourcePath !== decision.sourcePath);
    // A successful upload may reuse an existing file without moving it to the requested group.
    let verified = false;
    try {
      const page = await gateway.request('listPhotos', { groupId, page: 1, pageSize: 100 });
      verified = page.items.some((photo) => photo.id === uploaded.id);
    } catch {
      /* A readback failure must never retry the successful upload. */
    }
    outcomes.push(
      t(verified ? 'photos.transfer.locationConfirmed' : 'photos.transfer.locationUnconfirmed', {
        name: fileName,
        id: uploaded.id
      })
    );
    importResult.value = outcomes.join('\n');
  }
  emit('imported', imported);
  toast.success(t('photos.transfer.s3Imported', { count: imported }));
}

function reset(): void {
  selectedFileName.value = '';
  selectedFileSize.value = 0;
  selectedArchive.value = null;
  error.value = '';
  validating.value = false;
  confirmOpen.value = false;
  storage.value = 'zip';
  s3Decisions.value = [];
  s3Scanning.value = false;
  importResult.value = '';
}

async function loadPhotoGroupPaths(preserveCase = false): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  const roots = (await gateway.request('listPhotoGroups', undefined)).filter(
    (group) => group.id !== '-1' && group.parentId === null
  );
  await appendGroupPaths(roots, '', paths);
  if (!preserveCase && props.targetGroupId && props.targetGroupName) {
    if (!paths.has(props.targetGroupName)) paths.set(props.targetGroupName, props.targetGroupId);
  }
  return preserveCase ? paths : new Map([...paths].map(([path, id]) => [path.toLocaleLowerCase(), id]));
}

async function appendGroupPaths(
  groups: readonly PhotoGroup[],
  parentPath: string,
  paths: Map<string, string>
): Promise<void> {
  for (const group of groups) {
    const path = parentPath ? `${parentPath}/${group.name}` : group.name;
    paths.set(path, group.id);
    if (group.level < 3) {
      const children = (await gateway.request('listPhotoGroups', { parentId: group.id })).filter(
        (candidate) => candidate.id !== group.id && candidate.id !== '-1' && candidate.parentId === group.id
      );
      await appendGroupPaths(children, path, paths);
    }
  }
}

async function loadPhotoNames(groupId: string): Promise<Set<string>> {
  const names = new Set<string>();
  let page = 1;
  while (page <= 20) {
    const result = await gateway.request('listPhotos', { groupId, page, pageSize: 50 });
    for (const photo of result.items) names.add(photo.name.toLocaleLowerCase());
    if (page * result.pageSize >= result.total) break;
    page += 1;
  }
  return names;
}

function imageContentType(path: string): string | null {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'bmp') return 'image/bmp';
  return null;
}

function fileNameFromPath(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function renamedFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const suffix = `-${Date.now().toString(36)}`;
  return dot > 0 ? `${fileName.slice(0, dot)}${suffix}${fileName.slice(dot)}` : `${fileName}${suffix}`;
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
      t(
        storage === 's3'
          ? mode === 'export'
            ? 'photos.transfer.s3ExportDescription'
            : 'photos.transfer.s3ScanDescription'
          : mode === 'export'
            ? 'photos.transfer.exportDescription'
            : 'photos.transfer.importDescription',
        {
          count: photos.length,
          group: targetGroupName
        }
      )
    "
    :dismissible="!busy"
    @update:open="requestOpen"
  >
    <div class="space-y-4">
      <div class="flex flex-wrap gap-2 rounded-lg bg-muted/40 p-1">
        <Button size="sm" :variant="storage === 'zip' ? 'default' : 'ghost'" @click="storage = 'zip'">
          <FileArchive class="size-4" />{{ t('photos.transfer.localZip') }}
        </Button>
        <Button
          size="sm"
          :variant="storage === 's3' ? 'default' : 'ghost'"
          :disabled="!s3Supported"
          @click="storage = 's3'"
        >
          <Cloud class="size-4" />S3
        </Button>
      </div>
      <p v-if="!s3Supported" class="text-xs text-muted-foreground">
        {{ t('photos.transfer.s3Unavailable') }}
      </p>
      <template v-if="mode === 'export'">
        <div v-if="storage === 's3'" class="grid gap-3">
          <label>{{ t('photos.transfer.prefix') }}<Input v-model="exportPrefix" :disabled="busy" /></label>
          <label
            >{{ t('photos.transfer.mapping') }}
            <select
              v-model="exportMapping"
              :disabled="busy"
              class="mt-1 w-full rounded-md border bg-background p-2"
            >
              <option value="flat">{{ t('photos.transfer.flat') }}</option>
              <option value="groups">{{ t('photos.transfer.groups') }}</option>
            </select>
          </label>
        </div>
        <div class="rounded-lg border bg-muted/30 p-4">
          <p class="font-medium">{{ t('photos.transfer.exportSummary', { count: photos.length }) }}</p>
          <p class="mt-1 text-sm text-muted-foreground">
            {{
              storage === 's3' ? t('photos.transfer.s3ExportDescription') : t('photos.transfer.archiveLimit')
            }}
          </p>
        </div>
      </template>
      <template v-else>
        <div v-if="storage === 'zip'" class="rounded-lg border border-dashed p-4">
          <Button variant="outline" :disabled="busy || validating" @click="chooseFile">
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
        <div v-if="storage === 'zip' && selectedFileName" class="rounded-lg border bg-muted/30 p-4">
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
        <div v-if="storage === 's3'" class="rounded-lg border p-4">
          <label class="mb-3 flex cursor-pointer items-center gap-2 text-sm">
            <input
              v-model="createMissingGroups"
              type="checkbox"
              :disabled="busy || s3Scanning"
              class="size-4 accent-primary"
            />
            {{ t('photos.transfer.createMissingGroups') }}
          </label>
          <label class="mb-3 block"
            >{{ t('photos.transfer.mapping') }}
            <select
              v-model="importMapping"
              :disabled="busy || s3Scanning"
              class="mt-1 w-full rounded-md border bg-background p-2"
            >
              <option value="rules">{{ t('photos.transfer.rules') }}</option>
              <option value="current">{{ t('photos.transfer.current', { group: targetGroupName }) }}</option>
            </select>
          </label>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="font-medium">{{ t('photos.transfer.s3ScanTitle') }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ t('photos.transfer.s3ScanDescription') }}</p>
            </div>
            <Button variant="outline" :disabled="s3Scanning || busy" @click="scanS3">
              <LoaderCircle v-if="s3Scanning" class="size-4 animate-spin" />
              <RefreshCw v-else class="size-4" />
              {{ t('photos.transfer.scanS3') }}
            </Button>
          </div>
          <p v-if="s3Decisions.length" class="mt-3 text-sm">
            {{ t('photos.transfer.s3ScanResult', { total: s3Decisions.length, count: s3ImportCount }) }}
          </p>
          <div v-if="s3Decisions.length" class="mt-3 max-h-56 overflow-auto rounded-md border">
            <div
              v-for="decision in s3Decisions.slice(0, 50)"
              :key="decision.sourcePath"
              class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-3 py-2 text-xs last:border-b-0"
            >
              <span class="truncate" :title="decision.sourcePath">{{ decision.sourcePath }}</span>
              <span
                :class="
                  decision.action === 'import'
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-muted-foreground'
                "
              >
                {{ decision.action === 'import' ? decision.targetGroupPath : t('photos.transfer.skipped') }}
              </span>
            </div>
          </div>
        </div>
        <p v-if="importResult" role="status" class="whitespace-pre-line rounded-md border p-3 text-sm">
          {{ importResult }}
        </p>
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
                  ? storage === 's3'
                    ? 'photos.transfer.exportToS3'
                    : 'photos.transfer.exportAction'
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
          ? storage === 's3'
            ? 'photos.transfer.s3ExportDescription'
            : 'photos.transfer.confirmExportDescription'
          : storage === 's3'
            ? 'photos.transfer.confirmS3ImportDescription'
            : 'photos.transfer.confirmImportDescription',
        {
          count:
            mode === 'export'
              ? photos.length
              : storage === 's3'
                ? s3ImportCount
                : (selectedArchive?.document.assets.length ?? 0),
          group: targetGroupName
        }
      )
    "
    :confirm-label="
      t(
        mode === 'export'
          ? storage === 's3'
            ? 'photos.transfer.exportToS3'
            : 'photos.transfer.exportAction'
          : 'photos.transfer.importAction'
      )
    "
    @confirm="execute"
  />
</template>
