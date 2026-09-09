<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Cloud, Download, FileArchive, LoaderCircle, RefreshCw, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { GalleryTaskError, type GalleryTransferTaskV1 } from '@one-vegetable/core/gallery-transfer-task';
import { useGalleryTransfers } from '../lib/gallery-transfer-service';
import { safeCode } from '@one-vegetable/core/gallery-transfer-runner';

import {
  GatewayException,
  GALLERY_TRANSFER_MAX_ARCHIVE_BYTES,
  evaluateGalleryImportRules,
  type GalleryImportDecision,
  type Photo
} from '@one-vegetable/core';

import ConfirmActionDialog from './ConfirmActionDialog.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import { useUiI18n } from '../i18n';
import { readGalleryTransferArchive, type GalleryTransferArchive } from '../lib/gallery-transfer-archive';
import { useServices } from '../lib/services';
import { loadGalleryImportRuleSet } from '../lib/gallery-import-rules-storage';
import type { S3ObjectPage } from '@one-vegetable/core/s3-storage';

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
}>();
const { control: bffControl, s3Storage } = useServices();
const control = s3Storage ?? bffControl;
const transfers = useGalleryTransfers();
const archiveBytes = ref<Uint8Array | null>(null);
const preparedTask = ref<GalleryTransferTaskV1 | null>(null);
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
let previewEpoch = 0;
let archiveEpoch = 0;
onBeforeUnmount(() => {
  previewEpoch += 1;
  archiveEpoch += 1;
});
watch([importMapping, () => props.targetGroupId, () => props.targetGroupName], () => {
  previewEpoch += 1;
  s3Scanning.value = false;
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
  if (!props.open || busy.value || s3Scanning.value || validating.value) return false;
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
  const epoch = ++archiveEpoch;
  selectedFileName.value = file.name;
  selectedFileSize.value = file.size;
  selectedArchive.value = null;
  error.value = '';
  validating.value = true;
  try {
    if (file.size > GALLERY_TRANSFER_MAX_ARCHIVE_BYTES) throw new Error(t('photos.transfer.archiveLimit'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (epoch !== archiveEpoch) return;
    const archive = await readGalleryTransferArchive(bytes);
    if (epoch === archiveEpoch) {
      selectedArchive.value = archive;
      archiveBytes.value = bytes;
    }
  } catch (reason: unknown) {
    if (epoch === archiveEpoch) error.value = message(reason);
  } finally {
    if (epoch === archiveEpoch) validating.value = false;
  }
}

async function prepareTask(): Promise<void> {
  if (!canExecute.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (!transfers) throw new GalleryTaskError('GALLERY_CONTEXT_UNAVAILABLE');
    preparedTask.value = await transfers.preview({
      direction: props.mode,
      storage: storage.value,
      photos: props.photos.map((photo) => ({ ...photo })),
      groupId: props.targetGroupId,
      groupName: props.targetGroupName,
      archiveBytes: archiveBytes.value,
      archiveName: selectedFileName.value,
      decisions: s3Decisions.value.map((decision) => ({ ...decision })),
      conflictPolicy: loadGalleryImportRuleSet().conflictPolicy,
      createMissingGroups: createMissingGroups.value,
      importMapping: importMapping.value,
      exportMapping: exportMapping.value,
      exportPrefix: exportPrefix.value
    });
    confirmOpen.value = true;
  } catch (reason) {
    error.value = t('photos.tasks.error', { code: safeCode(reason) });
  } finally {
    busy.value = false;
  }
}
async function execute(): Promise<void> {
  const task = preparedTask.value;
  if (!task || !transfers || busy.value) return;
  preparedTask.value = null;
  busy.value = true;
  confirmOpen.value = false;
  try {
    await transfers.create(task, archiveBytes.value);
    emit('update:open', false);
    toast.success(t('photos.tasks.created'));
    void transfers.run(task.id);
  } catch (reason) {
    error.value = t('photos.tasks.error', { code: safeCode(reason) });
  } finally {
    busy.value = false;
  }
}

async function scanS3(): Promise<void> {
  if (!props.open || busy.value || s3Scanning.value || !control?.listS3Objects) return;
  const epoch = ++previewEpoch;
  s3Scanning.value = true;
  error.value = '';
  try {
    const objects = [];
    let continuationToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      if (continuationToken && seenTokens.has(continuationToken))
        throw new GalleryTaskError('GALLERY_TASK_PAGINATION');
      if (continuationToken) seenTokens.add(continuationToken);
      const page: S3ObjectPage = await control.listS3Objects({
        maximum: Math.min(500 - objects.length, 500),
        ...(continuationToken ? { continuationToken } : {})
      });
      if (epoch !== previewEpoch) return;
      objects.push(...page.items);
      continuationToken = page.nextContinuationToken ?? undefined;
    } while (continuationToken && objects.length < 500);
    if (continuationToken) throw new GalleryTaskError('GALLERY_TASK_LIMIT');
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
    if (epoch === previewEpoch) {
      error.value = message(reason);
      s3Decisions.value = [];
    }
  } finally {
    if (epoch === previewEpoch) s3Scanning.value = false;
  }
}

function reset(): void {
  previewEpoch += 1;
  archiveEpoch += 1;
  selectedFileName.value = '';
  selectedFileSize.value = 0;
  selectedArchive.value = null;
  archiveBytes.value = null;
  preparedTask.value = null;
  error.value = '';
  validating.value = false;
  confirmOpen.value = false;
  storage.value = 'zip';
  s3Decisions.value = [];
  s3Scanning.value = false;
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

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}

function message(reason: unknown): string {
  if (reason instanceof GatewayException && reason.gatewayError.code.startsWith('S3_'))
    return t(`errors.codes.${reason.gatewayError.code}`);
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
        <Button
          size="sm"
          :variant="storage === 'zip' ? 'default' : 'ghost'"
          :disabled="busy || s3Scanning || validating"
          @click="storage = 'zip'"
        >
          <FileArchive class="size-4" />{{ t('photos.transfer.localZip') }}
        </Button>
        <Button
          size="sm"
          :variant="storage === 's3' ? 'default' : 'ghost'"
          :disabled="!s3Supported || busy || s3Scanning || validating"
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
        <Button :disabled="busy || !canExecute" @click="prepareTask">
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
  >
    <div v-if="preparedTask" class="max-h-64 overflow-auto text-sm">
      <p>{{ t('photos.tasks.preview') }}</p>
      <div v-for="item in preparedTask.items" :key="item.id" class="border-b py-2">
        {{ item.fileName }} → {{ item.targetPath || preparedTask.batchPrefix }} ·
        {{ t('photos.tasks.kind.' + item.kind) }} · {{ t('photos.tasks.item.' + item.status) }}
      </div>
    </div>
  </ConfirmActionDialog>
</template>
