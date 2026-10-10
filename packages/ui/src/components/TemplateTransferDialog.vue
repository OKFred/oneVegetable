<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { toast } from 'vue-sonner';
import {
  encodeTemplateBundle,
  importTemplateBundle,
  parseTemplateBundle,
  templateError,
  TEMPLATE_BUNDLE_MAX_BYTES,
  type TemplateBundle,
  type TemplateImportOutcome
} from '@one-vegetable/core/template-library';
import type { ControlClient, ProductDescriptionTemplate } from '@one-vegetable/core';
import type { S3StorageControl, S3ObjectSummary } from '@one-vegetable/core/s3-storage';
import {
  prepareTemplateBackup,
  assertTemplateBackupContext,
  verifyTemplateBackup,
  type TemplateBackupPlan
} from '../lib/template-s3';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { downloadGalleryFile } from '../lib/gallery-transfer-service';
import { useServices } from '../lib/services';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import SafeHtmlContent from './SafeHtmlContent.vue';

const props = defineProps<{
  open: boolean;
  mode: 'import' | 'export';
  templates: readonly ProductDescriptionTemplate[];
}>();
const emit = defineEmits<{ 'update:open': [open: boolean]; imported: [] }>();
const { control, s3Storage, productDescriptionTemplates } = useServices();
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
const identity = useListIdentityScope();
const initialIdentity = identity.value;
let alive = true;
const isCurrent = () => alive && identity.value === initialIdentity;
onBeforeUnmount(() => {
  alive = false;
});
const destination = ref<'json' | 's3'>('json');
const prefix = ref('templates');
const key = ref('');
const fileName = ref('');
const bundle = shallowRef<TemplateBundle | null>(null);
const plan = shallowRef<TemplateBackupPlan | null>(null);
const objects = ref<S3ObjectSummary[]>([]);
const busy = ref(false);
const error = shallowRef<unknown>(null);
const conflict = ref<'skip' | 'copy'>('skip');
const confirmation = ref(false);
const writeStarted = ref(false);
const outcomes = ref<TemplateImportOutcome[]>([]);
const frozenTemplates = props.templates.map((item) => ({ ...item }));
const count = computed(() =>
  props.mode === 'import' ? (bundle.value?.templates.length ?? 0) : frozenTemplates.length
);
const actionLabel = computed(() => t(`products.transfer.${props.mode}`));
const ready = computed(
  () =>
    isCurrent() &&
    !busy.value &&
    !writeStarted.value &&
    count.value > 0 &&
    count.value <= 100 &&
    (props.mode === 'export' || bundle.value !== null)
);
watch([destination, prefix, key], () => {
  bundle.value = null;
  plan.value = null;
  error.value = null;
});
watch(identity, () => {
  error.value = templateError('TEMPLATE_CONTEXT_CHANGED');
  confirmation.value = false;
});
function assertCurrent(): void {
  if (!isCurrent()) throw templateError('TEMPLATE_CONTEXT_CHANGED');
}

async function chooseFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  bundle.value = null;
  error.value = null;
  fileName.value = file?.name ?? '';
  if (!file) return;
  busy.value = true;
  try {
    if (file.size > TEMPLATE_BUNDLE_MAX_BYTES) throw templateError('TEMPLATE_PACKAGE_TOO_LARGE');
    const parsed = parseTemplateBundle(new Uint8Array(await file.arrayBuffer()));
    assertCurrent();
    bundle.value = parsed;
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
    input.value = '';
  }
}
async function listPackages(): Promise<void> {
  if (!storage) return;
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
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function readPackage(): Promise<void> {
  if (!storage || !key.value) return;
  busy.value = true;
  error.value = null;
  bundle.value = null;
  try {
    const source = key.value;
    const result = await storage.getS3Object(source);
    assertCurrent();
    if (source !== key.value) return;
    bundle.value = parseTemplateBundle(result.bytes);
  } catch (cause: unknown) {
    error.value = cause;
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
      if (destination.value === 's3') {
        if (!storage) throw templateError('S3_NOT_CONFIGURED');
        plan.value = await prepareTemplateBackup(storage, frozenTemplates, prefix.value);
      } else encodeTemplateBundle(frozenTemplates);
    }
    assertCurrent();
    confirmation.value = true;
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function verify(): Promise<void> {
  if (!storage || !plan.value) return;
  busy.value = true;
  error.value = null;
  try {
    await verifyTemplateBackup(storage, plan.value, isCurrent);
    toast.success(t('products.templates.transfer.backedUp', { key: plan.value.key }));
    emit('update:open', false);
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
async function execute(): Promise<void> {
  if (busy.value || writeStarted.value) return;
  confirmation.value = false;
  busy.value = true;
  error.value = null;
  try {
    assertCurrent();
    if (props.mode === 'import') {
      if (!productDescriptionTemplates || !bundle.value) return;
      writeStarted.value = true;
      outcomes.value = await importTemplateBundle(
        productDescriptionTemplates,
        bundle.value,
        conflict.value,
        undefined,
        isCurrent
      );
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
      downloadGalleryFile(
        'one-vegetable-templates.json',
        encodeTemplateBundle(frozenTemplates),
        'application/json'
      );
      toast.success(t('products.templates.transfer.download'));
    } else if (storage && plan.value) {
      await assertTemplateBackupContext(storage, plan.value, isCurrent);
      writeStarted.value = true;
      await storage.putS3Object({
        key: plan.value.key,
        bytes: plan.value.bytes,
        contentType: 'application/json'
      });
      await verifyTemplateBackup(storage, plan.value, isCurrent);
      toast.success(t('products.templates.transfer.backedUp', { key: plan.value.key }));
    }
    emit('update:open', false);
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="actionLabel"
    :description="t('products.templates.transfer.content')"
    :dismissible="!busy"
    size="lg"
    @update:open="emit('update:open', $event)"
  >
    <div class="space-y-4">
      <p class="text-xs text-muted-foreground">{{ t('products.templates.transfer.limit') }}</p>
      <label class="block text-sm"
        >{{ t('products.templates.transfer.storage') }}
        <select
          v-model="destination"
          :disabled="busy || writeStarted"
          class="mt-1 h-9 w-full rounded-md border bg-background px-3"
        >
          <option value="json">{{ t('products.templates.transfer.file') }}</option>
          <option v-if="storage" value="s3">{{ t('products.templates.transfer.s3') }}</option>
        </select>
      </label>
      <template v-if="destination === 's3'">
        <label class="block text-sm"
          >{{ t('products.templates.transfer.prefix')
          }}<Input v-model="prefix" :disabled="busy || writeStarted" class="mt-1"
        /></label>
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
        accept="application/json,.json"
        :aria-label="t('products.templates.transfer.file')"
        :disabled="busy || writeStarted"
        @change="chooseFile"
      />
      <p v-if="fileName" class="text-sm">{{ fileName }}</p>
      <template v-if="mode === 'import' && bundle">
        <p>{{ t('products.templates.transfer.preview', { count }) }}</p>
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
        <details v-for="(item, index) in bundle.templates" :key="index" class="rounded-md border p-3">
          <summary class="cursor-pointer text-sm">{{ item.name }} · {{ item.language }}</summary>
          <SafeHtmlContent :html="item.html" class="mt-2 max-h-60 overflow-auto" />
        </details>
      </template>
      <p v-else-if="mode === 'export'">{{ t('common.data.selected', { count }) }}</p>
      <ErrorNotice v-if="error" :error="error" compact />
      <p v-if="writeStarted && mode === 'export' && error" class="text-sm text-muted-foreground">
        {{ t('products.templates.transfer.unknown') }}<br />{{ plan?.key }}
      </p>
      <Button
        v-if="writeStarted && mode === 'export' && error"
        variant="outline"
        :disabled="busy"
        @click="verify"
        >{{ t('photos.tasks.verify') }}</Button
      >
      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">{{
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
    :description="t('products.templates.transfer.confirm', { action: actionLabel, count })"
    @confirm="execute"
  />
</template>
