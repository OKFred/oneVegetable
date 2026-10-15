<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { toast } from 'vue-sonner';
import { GatewayException } from '@one-vegetable/core/errors';
import { GalleryTaskError } from '@one-vegetable/core/gallery-transfer-task';
import {
  encodeTemplateBundle,
  importTemplateBundle,
  parseTemplateBundle,
  templateError,
  TEMPLATE_BUNDLE_MAX_BYTES,
  type TemplateBundle,
  type TemplateImportOutcome
} from '@one-vegetable/core/template-library';
import {
  isPhotoBankUrl,
  type ControlClient,
  type PhotoGroup,
  type ProductDescriptionTemplate
} from '@one-vegetable/core';
import {
  TEMPLATE_MATERIAL_MAX_ZIP_BYTES,
  templateImageSources,
  type TemplateMaterialPackage
} from '@one-vegetable/core/template-materials';
import type { S3StorageControl, S3ObjectSummary } from '@one-vegetable/core/s3-storage';
import {
  prepareTemplateBackup,
  assertTemplateBackupContext,
  verifyTemplateBackup,
  type TemplateBackupPlan
} from '../lib/template-s3';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { downloadGalleryFile, useGalleryTransfers } from '../lib/gallery-transfer-service';
import { readTemplateMaterialArchive, createTemplateMaterialArchive } from '../lib/template-material-archive';
import {
  prepareTemplateMaterialExport,
  prepareTemplateMaterialImport,
  executeTemplateMaterialImport,
  type TemplateMaterialExportPlan,
  type TemplateMaterialImportPlan,
  type TemplateMaterialProgress
} from '../lib/template-material-transfer';
import {
  prepareTemplateMaterialBackup,
  executeTemplateMaterialBackup,
  verifyTemplateMaterialBackup,
  readTemplateMaterialBackup,
  type TemplateMaterialBackupPlan
} from '../lib/template-material-s3';
import { useServices } from '../lib/services';
import { useUiI18n } from '../i18n';
import { useTemplateMaterialsI18n } from '../i18n/template-materials';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import SafeHtmlContent from './SafeHtmlContent.vue';
import PhotoGroupNavigation from './PhotoGroupNavigation.vue';

const props = defineProps<{
  open: boolean;
  mode: 'import' | 'export';
  templates: readonly ProductDescriptionTemplate[];
}>();
const emit = defineEmits<{ 'update:open': [open: boolean]; imported: [] }>();
const services = useServices();
const { control, s3Storage, productDescriptionTemplates, operationAvailability } = services;
const transfers = useGalleryTransfers();
async function showMaterialTasks(): Promise<void> {
  if (busy.value || !transfers || !isCurrent()) return;
  // The task Sheet sits below a modal dialog: close the modal before opening it.
  emit('update:open', false);
  await nextTick();
  transfers.show();
}
function isStorage(value: ControlClient | undefined): value is ControlClient & S3StorageControl {
  return (
    value !== undefined &&
    [
      's3StorageConfiguration',
      'updateS3StorageConfiguration',
      'clearS3StorageConfiguration',
      'testS3StorageConnection',
      'listS3Objects',
      'getS3Object',
      'putS3Object'
    ].every((method) => typeof Reflect.get(value, method) === 'function')
  );
}
const storage = s3Storage ?? (isStorage(control) ? control : undefined);
const { t } = useUiI18n();
const mt = useTemplateMaterialsI18n();
const identity = useListIdentityScope();
const initialIdentity = identity.value;
let alive = true;
let identityChanged = false;
const isCurrent = () => alive && props.open && !identityChanged && identity.value === initialIdentity;
onBeforeUnmount(() => {
  alive = false;
});
const destination = ref<'json' | 's3'>('json');
const format = ref<'json' | 'zip'>('json');
const includeImages = ref(false);
const prefix = ref('templates');
const key = ref('');
const fileName = ref('');
const bundle = shallowRef<TemplateBundle | null>(null);
const materialPackage = shallowRef<TemplateMaterialPackage | null>(null);
const materialExport = shallowRef<TemplateMaterialExportPlan | null>(null);
const materialImport = shallowRef<TemplateMaterialImportPlan | null>(null);
const materialBackup = shallowRef<TemplateMaterialBackupPlan | null>(null);
const archive = shallowRef<Uint8Array | null>(null);
const targetGroup = shallowRef<PhotoGroup | null>(null);
const reuseExistingPhotos = ref(false);
const reusePermissionOrigins = ref<string[]>([]);
const reusePermissionHosts = computed(() =>
  reusePermissionOrigins.value.map((origin) => new URL(origin.slice(0, -2)).hostname).join(', ')
);
const progress = shallowRef<TemplateMaterialProgress | null>(null);
const permissionPending = ref(false);
const permissionReason = ref<'permissionUnavailable' | 'permissionDenied' | null>(null);
const uploadAllowed = ref(false);
const uploadReason = ref('OPERATION_AVAILABILITY_UNAVAILABLE');
const plan = shallowRef<TemplateBackupPlan | null>(null);
const objects = ref<S3ObjectSummary[]>([]);
const busy = ref(false);
const error = shallowRef<unknown>(null);
const conflict = ref<'skip' | 'copy'>('skip');
const confirmation = ref(false);
const writeStarted = ref(false);
const outcomes = ref<TemplateImportOutcome[]>([]);
const frozenTemplates = props.templates.map((item) => ({ ...item }));
const materialExportSelected = computed(
  () =>
    props.mode === 'export' && (destination.value === 'json' ? format.value === 'zip' : includeImages.value)
);
const exportSources = computed(() => {
  if (!materialExportSelected.value) return { count: 0, unsupported: false };
  try {
    return { count: templateImageSources(frozenTemplates).length, unsupported: false };
  } catch {
    return { count: 0, unsupported: true };
  }
});
const images = computed(
  () =>
    materialPackage.value?.document.assets.length ?? materialExport.value?.package.document.assets.length ?? 0
);
const previewTemplates = computed(
  () => materialPackage.value?.document.templates ?? bundle.value?.templates ?? []
);
const count = computed(() =>
  props.mode === 'import' ? previewTemplates.value.length : frozenTemplates.length
);
const actionLabel = computed(() => t(`products.transfer.${props.mode}`));
const requiresUpload = computed(() => props.mode === 'import' && images.value > 0);
const imagePlan = computed(() => {
  const task = materialImport.value?.task;
  if (!task) return { uploads: images.value, reused: 0, verifyOnly: false };
  const verifyOnly = task.items.some((item) => ['unknown', 'unconfirmed', 'running'].includes(item.status));
  return {
    uploads:
      verifyOnly || task.status === 'cancelled'
        ? 0
        : task.items.filter((item) => !['confirmed', 'skipped'].includes(item.status)).length,
    reused: task.items.filter((item) => item.status === 'confirmed').length,
    verifyOnly
  };
});
const validGroup = computed(
  () =>
    !!targetGroup.value?.id.trim() && targetGroup.value.id.trim() !== '-1' && !!targetGroup.value.name.trim()
);
const disabledReason = computed(() => {
  if (!isCurrent()) return t('errors.codes.TEMPLATE_CONTEXT_CHANGED');
  if (props.mode === 'import' && !productDescriptionTemplates) return mt('templatesUnavailable');
  if (destination.value === 's3' && !storage) return mt('storageUnavailable');
  if (exportSources.value.unsupported) return t('errors.codes.TEMPLATE_MATERIAL_SOURCE_UNSUPPORTED');
  if (requiresUpload.value || exportSources.value.count > 0) {
    if (!services.gateway.galleryTransferContext) return mt('galleryUnavailable');
  }
  if (requiresUpload.value) {
    if (!transfers) return mt('transfersUnavailable');
    if (services.mode === 'bff' && !control) return mt('permissionUnavailable');
    if (!operationAvailability) return mt('availabilityUnavailable');
    if (permissionPending.value) return mt('permissionPending');
    if (permissionReason.value) return mt(permissionReason.value);
    if (!uploadAllowed.value) return mt('uploadDenied', { code: uploadReason.value });
    if (!validGroup.value) return mt('chooseGroup');
  }
  return '';
});
const ready = computed(
  () =>
    isCurrent() &&
    !busy.value &&
    !writeStarted.value &&
    count.value > 0 &&
    count.value <= 100 &&
    !disabledReason.value &&
    (props.mode === 'export' || bundle.value !== null || materialPackage.value !== null)
);
const confirmationDescription = computed(() => {
  const reuseNotice = requiresUpload.value && reuseExistingPhotos.value ? ` ${mt('confirmReuse')}` : '';
  if (requiresUpload.value && imagePlan.value.verifyOnly)
    return (
      mt('confirmVerify', { templates: count.value, group: targetGroup.value?.name ?? '' }) + reuseNotice
    );
  if (requiresUpload.value)
    return (
      mt('confirmImport', {
        templates: count.value,
        images: images.value,
        group: targetGroup.value?.name ?? ''
      }) + reuseNotice
    );
  if (materialPackage.value || materialExportSelected.value)
    return mt('confirm', { action: actionLabel.value, templates: count.value, images: images.value });
  return t('products.templates.transfer.confirm', { action: actionLabel.value, count: count.value });
});
const backupKey = computed(() => materialBackup.value?.key ?? plan.value?.key ?? '');
function clearPrepared(): void {
  reusePermissionOrigins.value = [];
  materialExport.value = null;
  materialImport.value = null;
  materialBackup.value = null;
  archive.value = null;
  plan.value = null;
  confirmation.value = false;
  progress.value = null;
}
watch([destination, prefix, key, format, includeImages], () => {
  if (writeStarted.value) return;
  bundle.value = null;
  materialPackage.value = null;
  targetGroup.value = null;
  fileName.value = '';
  clearPrepared();
  error.value = null;
});
watch(
  identity,
  () => {
    identityChanged = true;
    bundle.value = null;
    materialPackage.value = null;
    targetGroup.value = null;
    objects.value = [];
    fileName.value = '';
    uploadAllowed.value = false;
    clearPrepared();
    error.value = templateError('TEMPLATE_CONTEXT_CHANGED');
    confirmation.value = false;
  },
  { flush: 'sync' }
);
watch([targetGroup, conflict, reuseExistingPhotos], () => {
  if (!writeStarted.value) {
    materialImport.value = null;
    confirmation.value = false;
  }
});
watch(
  () => props.open,
  (open) => {
    if (!open) {
      confirmation.value = false;
      bundle.value = null;
      materialPackage.value = null;
      objects.value = [];
      fileName.value = '';
      if (!writeStarted.value) clearPrepared();
    }
  }
);
watch(requiresUpload, (required) => {
  if (required) void checkUploadPermission();
});
function assertCurrent(): void {
  if (!isCurrent()) throw templateError('TEMPLATE_CONTEXT_CHANGED');
}
function requestOpen(open: boolean): void {
  if (!busy.value) emit('update:open', open);
}
function selectGroup(group: PhotoGroup): void {
  if (!busy.value && !writeStarted.value && isCurrent()) targetGroup.value = { ...group };
}
async function checkUploadPermission(): Promise<void> {
  permissionPending.value = true;
  uploadAllowed.value = false;
  permissionReason.value = null;
  try {
    assertCurrent();
    if (services.mode === 'bff') {
      if (!control) {
        permissionReason.value = 'permissionUnavailable';
        return;
      }
      const session = await control.session();
      assertCurrent();
      if (session.principal.role !== 'admin') {
        permissionReason.value = 'permissionDenied';
        return;
      }
    }
    if (!operationAvailability) return;
    const result = await operationAvailability.get(['uploadPhoto']);
    assertCurrent();
    const decision = result.items.find((item) => item.operation === 'uploadPhoto');
    uploadAllowed.value = decision?.allowed === true;
    uploadReason.value = decision?.reasonCode ?? 'OPERATION_AVAILABILITY_UNAVAILABLE';
  } catch {
    if (isCurrent()) permissionReason.value = 'permissionUnavailable';
  } finally {
    permissionPending.value = false;
  }
}
function onProgress(value: TemplateMaterialProgress): void {
  if (isCurrent()) progress.value = value;
}

async function chooseFile(event: Event): Promise<void> {
  if (busy.value || writeStarted.value || !isCurrent()) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  bundle.value = null;
  materialPackage.value = null;
  targetGroup.value = null;
  clearPrepared();
  error.value = null;
  fileName.value = file?.name ?? '';
  if (!file) return;
  busy.value = true;
  try {
    if (file.size > TEMPLATE_MATERIAL_MAX_ZIP_BYTES) throw templateError('TEMPLATE_MATERIAL_ZIP_TOO_LARGE');
    const bytes = new Uint8Array(await file.arrayBuffer());
    assertCurrent();
    // The signature is authoritative, not an extension or an untrusted MIME type.
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const parsed = await readTemplateMaterialArchive(bytes);
      assertCurrent();
      materialPackage.value = parsed;
    } else {
      if (file.size > TEMPLATE_BUNDLE_MAX_BYTES) throw templateError('TEMPLATE_PACKAGE_TOO_LARGE');
      bundle.value = parseTemplateBundle(bytes);
    }
  } catch (cause: unknown) {
    if (isCurrent()) error.value = cause;
  } finally {
    busy.value = false;
    input.value = '';
  }
}
async function listPackages(): Promise<void> {
  if (!storage || busy.value || writeStarted.value || !isCurrent()) return;
  busy.value = true;
  error.value = null;
  objects.value = [];
  key.value = '';
  try {
    const values = new Map<string, S3ObjectSummary>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      assertCurrent();
      const result = await storage.listS3Objects({
        prefix: prefix.value.trim(),
        maximum: 100,
        ...(cursor ? { continuationToken: cursor } : {})
      });
      assertCurrent();
      for (const item of result.items)
        if (item.key.endsWith('/templates.json') && item.size <= TEMPLATE_BUNDLE_MAX_BYTES)
          values.set(item.key, item);
      if (!result.nextContinuationToken) {
        objects.value = [...values.values()];
        return;
      }
      if (cursors.has(result.nextContinuationToken)) break;
      cursors.add(result.nextContinuationToken);
      cursor = result.nextContinuationToken;
    }
    throw templateError('S3_PAGINATION_INCOMPLETE');
  } catch (cause: unknown) {
    if (isCurrent()) error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function readPackage(): Promise<void> {
  if (!storage || !key.value || busy.value || writeStarted.value || !isCurrent()) return;
  busy.value = true;
  error.value = null;
  bundle.value = null;
  materialPackage.value = null;
  targetGroup.value = null;
  clearPrepared();
  try {
    const source = key.value;
    const pack = await readTemplateMaterialBackup(storage, source, isCurrent);
    assertCurrent();
    if (source !== key.value) return;
    if (pack) materialPackage.value = pack;
    else {
      const result = await storage.getS3Object(source);
      assertCurrent();
      if (source === key.value) bundle.value = parseTemplateBundle(result.bytes);
    }
  } catch (cause: unknown) {
    if (isCurrent()) error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function prepare(): Promise<void> {
  if (!ready.value) return;
  busy.value = true;
  error.value = null;
  try {
    assertCurrent();
    if (props.mode === 'export') {
      if (materialExportSelected.value) {
        materialExport.value = await prepareTemplateMaterialExport(
          services,
          frozenTemplates,
          isCurrent,
          onProgress
        );
        assertCurrent();
        if (destination.value === 's3') {
          if (!storage) throw templateError('S3_NOT_CONFIGURED');
          materialBackup.value = await prepareTemplateMaterialBackup(
            storage,
            materialExport.value,
            prefix.value,
            isCurrent
          );
        } else {
          progress.value = { phase: 'packing', current: 0, total: 1 };
          archive.value = await createTemplateMaterialArchive(materialExport.value.package);
          progress.value = { phase: 'packing', current: 1, total: 1 };
        }
      } else if (destination.value === 's3') {
        if (!storage) throw templateError('S3_NOT_CONFIGURED');
        plan.value = await prepareTemplateBackup(storage, frozenTemplates, prefix.value);
      } else encodeTemplateBundle(frozenTemplates);
    } else if (materialPackage.value) {
      if (requiresUpload.value) {
        await checkUploadPermission();
        assertCurrent();
        if (disabledReason.value) throw new Error(disabledReason.value);
      }
      materialImport.value = await prepareTemplateMaterialImport(
        transfers,
        materialPackage.value,
        targetGroup.value?.id ?? '',
        targetGroup.value?.name ?? '',
        isCurrent,
        reuseExistingPhotos.value
      );
      if (requiresUpload.value && reuseExistingPhotos.value && services.mode === 'extension') {
        const page = await services.gateway.request('listPhotos', { page: 1, pageSize: 100 });
        assertCurrent();
        reusePermissionOrigins.value = [
          ...new Set(
            page.items.flatMap((photo) => {
              if (!isPhotoBankUrl(photo.url)) return [];
              const url = new URL(photo.url.startsWith('//') ? `https:${photo.url}` : photo.url);
              return url.protocol === 'https:' ? [`${url.origin}/*`] : [];
            })
          )
        ];
      }
    }
    assertCurrent();
    confirmation.value = true;
  } catch (cause: unknown) {
    if (isCurrent()) error.value = cause;
    else clearPrepared();
  } finally {
    busy.value = false;
  }
}
async function verify(): Promise<void> {
  if (!storage || (!plan.value && !materialBackup.value) || busy.value || !writeStarted.value || !isCurrent())
    return;
  busy.value = true;
  error.value = null;
  try {
    if (materialBackup.value) await verifyTemplateMaterialBackup(storage, materialBackup.value, isCurrent);
    else if (plan.value) await verifyTemplateBackup(storage, plan.value, isCurrent);
    assertCurrent();
    toast.success(t('products.templates.transfer.backedUp', { key: backupKey.value }));
    emit('update:open', false);
  } catch (cause: unknown) {
    if (isCurrent()) error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function execute(): Promise<void> {
  if (!confirmation.value || !ready.value) return;
  confirmation.value = false;
  busy.value = true;
  error.value = null;
  try {
    assertCurrent();
    // Start the optional permission request in this confirmation click, before any await.
    if (props.mode === 'import' && reusePermissionOrigins.value.length) {
      const allowed = services.permissions?.request?.([...reusePermissionOrigins.value]);
      if (!allowed || !(await allowed)) throw templateError('TEMPLATE_MATERIAL_PERMISSION_REQUIRED');
      assertCurrent();
    }
    if (props.mode === 'import') {
      if (!productDescriptionTemplates) return;
      if (materialPackage.value) {
        if (!materialImport.value) return;
        if (requiresUpload.value) {
          await checkUploadPermission();
          assertCurrent();
          if (disabledReason.value) throw new Error(disabledReason.value);
        }
      } else if (!bundle.value) return;
      writeStarted.value = true;
      if (materialImport.value) {
        outcomes.value = await executeTemplateMaterialImport(
          services,
          transfers,
          materialImport.value,
          conflict.value,
          isCurrent,
          onProgress
        );
      } else if (bundle.value) {
        outcomes.value = await importTemplateBundle(
          productDescriptionTemplates,
          bundle.value,
          conflict.value,
          undefined,
          isCurrent
        );
      }
      assertCurrent();
      emit('imported');
      const failed = outcomes.value.find((item) => item.status === 'failed');
      toast[failed ? 'warning' : 'success'](
        t('products.templates.transfer.done', {
          created: outcomes.value.filter((item) => item.status === 'created').length,
          skipped: outcomes.value.filter((item) => item.status === 'skipped').length,
          failed: failed ? 1 : 0
        })
      );
      assertCurrent();
      if (failed) {
        error.value = failed.error;
        return;
      }
    } else if (destination.value === 'json') {
      if (format.value === 'zip') {
        if (!archive.value) return;
        downloadGalleryFile('one-vegetable-template-materials.zip', archive.value, 'application/zip');
      } else {
        downloadGalleryFile(
          'one-vegetable-templates.json',
          encodeTemplateBundle(frozenTemplates),
          'application/json'
        );
      }
      toast.success(t('products.templates.transfer.download'));
    } else if (storage && materialBackup.value) {
      // Set before dispatch: an uncertain result may only be verified, never resent.
      writeStarted.value = true;
      await executeTemplateMaterialBackup(storage, materialBackup.value, isCurrent, onProgress);
      await verifyTemplateMaterialBackup(storage, materialBackup.value, isCurrent);
      assertCurrent();
      toast.success(t('products.templates.transfer.backedUp', { key: materialBackup.value.key }));
    } else if (storage && plan.value) {
      await assertTemplateBackupContext(storage, plan.value, isCurrent);
      writeStarted.value = true;
      await storage.putS3Object({
        key: plan.value.key,
        bytes: plan.value.bytes,
        contentType: 'application/json'
      });
      await verifyTemplateBackup(storage, plan.value, isCurrent);
      assertCurrent();
      toast.success(t('products.templates.transfer.backedUp', { key: plan.value.key }));
    }
    emit('update:open', false);
  } catch (cause: unknown) {
    if (isCurrent()) {
      // A busy-task rejection happens before this attempt sends any write.
      // Keep the dialog editable, but never unlock uncertain upload failures.
      if (
        props.mode === 'import' &&
        ((cause instanceof GatewayException && cause.gatewayError.code === 'GALLERY_TASK_BUSY') ||
          (cause instanceof GalleryTaskError && cause.code === 'GALLERY_TASK_BUSY'))
      )
        writeStarted.value = false;
      error.value = cause instanceof GalleryTaskError ? templateError(cause.code) : cause;
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="actionLabel"
    :description="
      mode === 'import' || materialExportSelected
        ? mt('description')
        : t('products.templates.transfer.content')
    "
    :dismissible="!busy"
    size="lg"
    @update:open="requestOpen"
  >
    <div class="space-y-4">
      <p class="text-xs text-muted-foreground">
        {{
          mode === 'import' || materialExportSelected
            ? mt('templateLimit')
            : t('products.templates.transfer.limit')
        }}
      </p>
      <label class="block text-sm"
        >{{ t('products.templates.transfer.storage') }}
        <select
          v-model="destination"
          :disabled="busy || writeStarted"
          class="mt-1 h-9 w-full rounded-md border bg-background px-3"
        >
          <option value="json">{{ mt('file') }}</option>
          <option v-if="storage" value="s3">{{ t('products.templates.transfer.s3') }}</option>
        </select>
      </label>
      <label v-if="mode === 'export' && destination === 'json'" class="block text-sm">
        {{ mt('format') }}
        <select
          v-model="format"
          data-testid="template-material-format"
          :disabled="busy || writeStarted"
          class="mt-1 h-9 w-full rounded-md border bg-background px-3"
        >
          <option value="json">{{ mt('json') }}</option>
          <option value="zip">{{ mt('zip') }}</option>
        </select>
      </label>
      <template v-if="destination === 's3'">
        <label class="block text-sm"
          >{{ t('products.templates.transfer.prefix')
          }}<Input v-model="prefix" :disabled="busy || writeStarted" class="mt-1"
        /></label>
        <label v-if="mode === 'export'" class="flex items-center gap-2 text-sm">
          <input v-model="includeImages" type="checkbox" :disabled="busy || writeStarted" />
          {{ mt('includeImages') }}
        </label>
        <p v-if="mode === 'export' && includeImages" class="text-xs text-muted-foreground">
          {{ mt('s3Images') }}
        </p>
        <template v-if="mode === 'import'">
          <Button variant="outline" :disabled="busy || writeStarted" @click="listPackages">{{
            t('products.templates.transfer.list')
          }}</Button>
          <label class="block text-sm"
            >{{ t('products.templates.transfer.choose') }}
            <select
              v-model="key"
              :disabled="busy || writeStarted"
              class="mt-1 h-9 w-full rounded-md border bg-background px-3"
            >
              <option value="">—</option>
              <option v-for="item in objects" :key="item.key" :value="item.key">{{ item.key }}</option>
            </select>
          </label>
          <Button variant="outline" :disabled="busy || writeStarted || !key" @click="readPackage">{{
            t('products.templates.transfer.prepare')
          }}</Button>
        </template>
      </template>
      <input
        v-else-if="mode === 'import'"
        type="file"
        accept="application/json,application/zip,.json,.zip"
        :aria-label="mt('file')"
        :disabled="busy || writeStarted"
        @change="chooseFile"
      />
      <p v-if="fileName" class="text-sm">{{ fileName }}</p>
      <p
        v-if="materialExportSelected || materialPackage || (mode === 'import' && destination === 'json')"
        class="text-xs text-muted-foreground"
      >
        {{ mt('limits') }}
      </p>
      <template v-if="mode === 'import' && (bundle || materialPackage)">
        <p>{{ t('products.templates.transfer.preview', { count }) }}</p>
        <template v-if="materialPackage">
          <p role="status" class="text-sm">{{ mt('preview', { templates: count, images }) }}</p>
          <details v-if="images" class="rounded-md border p-3">
            <summary class="cursor-pointer text-sm">{{ mt('files') }} · {{ images }}</summary>
            <ul class="mt-2 max-h-40 overflow-auto text-xs">
              <li v-for="asset in materialPackage.document.assets" :key="asset.path" class="break-all">
                {{ asset.fileName }} · {{ asset.path }} · {{ asset.byteLength }} B
              </li>
            </ul>
          </details>
          <section v-if="requiresUpload" :aria-label="mt('targetGroup')" class="space-y-2">
            <p class="text-sm font-medium">{{ mt('targetGroup') }}</p>
            <p class="text-xs text-muted-foreground">{{ mt('chooseGroup') }}</p>
            <fieldset
              :disabled="busy || writeStarted || !isCurrent()"
              class="max-h-48 overflow-auto rounded-md border"
            >
              <PhotoGroupNavigation
                v-if="
                  transfers &&
                  services.gateway.galleryTransferContext &&
                  uploadAllowed &&
                  !permissionReason &&
                  !permissionPending &&
                  isCurrent()
                "
                :model-value="targetGroup?.id ?? ''"
                @select="selectGroup"
              />
            </fieldset>
            <p v-if="validGroup" class="text-sm">{{ mt('selectedGroup', { name: targetGroup?.name }) }}</p>
            <label class="flex items-start gap-2 text-sm">
              <input
                v-model="reuseExistingPhotos"
                type="checkbox"
                class="mt-1"
                :disabled="busy || writeStarted"
                data-testid="template-reuse-existing-photos"
              />
              {{ mt('reuseExisting') }}
            </label>
            <p class="text-xs text-muted-foreground">{{ mt('reuseExplanation') }}</p>
            <p v-if="!materialImport" class="text-sm">{{ mt('uploadCount', { count: images }) }}</p>
            <p v-else class="text-sm">
              {{ mt('preparedImages', { uploads: imagePlan.uploads, reused: imagePlan.reused }) }}
            </p>
            <p v-if="imagePlan.verifyOnly" class="text-sm">{{ mt('verifyOnly') }}</p>
          </section>
        </template>
        <label class="block text-sm"
          >{{ t('products.templates.transfer.conflicts') }}
          <select
            v-model="conflict"
            :disabled="busy || writeStarted"
            class="mt-1 h-9 w-full rounded-md border bg-background px-3"
          >
            <option value="skip">{{ t('products.templates.transfer.skip') }}</option>
            <option value="copy">{{ t('products.templates.transfer.copy') }}</option>
          </select>
        </label>
        <details v-for="(item, index) in previewTemplates" :key="index" class="rounded-md border p-3">
          <summary class="cursor-pointer text-sm">{{ item.name }} · {{ item.language }}</summary>
          <SafeHtmlContent :html="item.html" class="mt-2 max-h-60 overflow-auto" />
        </details>
      </template>
      <p v-else-if="mode === 'export'">{{ t('common.data.selected', { count }) }}</p>
      <p v-if="disabledReason" role="status" class="text-sm text-muted-foreground">{{ disabledReason }}</p>
      <p v-if="progress" role="status" class="text-sm">
        {{ mt(progress.phase, { current: progress.current, total: progress.total }) }}
      </p>
      <ErrorNotice v-if="error" :error="error" compact />
      <p v-if="writeStarted && mode === 'export' && error" class="text-sm text-muted-foreground">
        {{ t('products.templates.transfer.unknown') }}<br />
        {{ mt('savedPath', { prefix, key: backupKey }) }}
      </p>
      <Button
        v-if="writeStarted && mode === 'export' && error"
        variant="outline"
        :disabled="busy || !isCurrent()"
        @click="verify"
        >{{ t('photos.tasks.verify') }}</Button
      >
      <p v-if="writeStarted && mode === 'import' && error" class="text-sm text-muted-foreground">
        {{ mt('unknownImport') }}
      </p>
      <p
        v-if="writeStarted && mode === 'import' && error && requiresUpload"
        class="text-sm text-muted-foreground"
      >
        {{ mt('materialRecovery') }}
      </p>
      <Button
        v-if="writeStarted && mode === 'import' && error && requiresUpload && transfers"
        variant="outline"
        :disabled="busy || !isCurrent()"
        @click="showMaterialTasks"
      >
        {{ mt('tasks') }}
      </Button>
      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="busy" @click="requestOpen(false)">{{
          t('common.actions.cancel')
        }}</Button>
        <Button :disabled="!ready" @click="prepare">{{
          busy ? t('common.actions.processing') : actionLabel
        }}</Button>
      </div>
    </div>
  </ModalDialog>
  <ConfirmActionDialog
    v-model:open="confirmation"
    :title="actionLabel"
    :description="confirmationDescription"
    :pending="busy"
    @confirm="execute"
  >
    <p v-if="reusePermissionOrigins.length" class="text-sm text-muted-foreground">
      {{
        mt('permissionNotice', {
          hosts: reusePermissionHosts
        })
      }}
    </p>
  </ConfirmActionDialog>
</template>
