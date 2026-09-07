<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Cloud, LoaderCircle, Save, Trash2, Unplug } from '@lucide/vue';
import { toast } from 'vue-sonner';

import type { S3StorageConfiguration, S3StorageConfigurationSummary } from '@one-vegetable/core';

import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import GalleryImportRulesSettings from './GalleryImportRulesSettings.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';

const { control } = useServices();
const { t } = useUiI18n();
const summary = ref<S3StorageConfigurationSummary | null>(null);
const busy = ref<'load' | 'save' | 'test' | 'clear' | null>(null);
const error = ref<unknown>(null);
const confirmClear = ref(false);
const model = reactive<S3StorageConfiguration>({
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: null,
  pathStyle: true,
  rootPrefix: 'one-vegetable/gallery'
});
const remark = ref<string | null>(null);
const supported = computed(
  () =>
    control?.s3StorageConfiguration !== undefined &&
    control.updateS3StorageConfiguration !== undefined &&
    control.testS3StorageConnection !== undefined
);
const canSave = computed(
  () =>
    busy.value === null &&
    model.endpoint.trim() !== '' &&
    model.region.trim() !== '' &&
    model.bucket.trim() !== '' &&
    model.accessKeyId.trim() !== '' &&
    model.secretAccessKey !== ''
);

onMounted(load);

async function load(): Promise<void> {
  if (!control?.s3StorageConfiguration) return;
  busy.value = 'load';
  error.value = null;
  try {
    summary.value = await control.s3StorageConfiguration();
    if (summary.value.configured) {
      model.endpoint = summary.value.endpoint ?? '';
      model.region = summary.value.region ?? 'auto';
      model.bucket = summary.value.bucket ?? '';
      model.pathStyle = summary.value.pathStyle ?? true;
      model.rootPrefix = summary.value.rootPrefix ?? '';
      remark.value = summary.value.remark;
    }
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = null;
  }
}

async function save(): Promise<void> {
  if (!control?.updateS3StorageConfiguration) return;
  busy.value = 'save';
  error.value = null;
  try {
    summary.value = await control.updateS3StorageConfiguration(
      {
        ...model,
        sessionToken: model.sessionToken?.trim() ? model.sessionToken.trim() : null
      },
      summary.value?.revision ?? null,
      remark.value
    );
    model.accessKeyId = '';
    model.secretAccessKey = '';
    model.sessionToken = null;
    toast.success(t('settings.s3.saved'));
  } catch (cause: unknown) {
    error.value = cause;
    toast.error(t('settings.s3.errors.save'));
  } finally {
    busy.value = null;
  }
}

async function testConnection(): Promise<void> {
  if (!control?.testS3StorageConnection) return;
  busy.value = 'test';
  error.value = null;
  try {
    const result = await control.testS3StorageConnection();
    toast.success(t('settings.s3.testPassed', { count: result.visibleObjectCount }));
  } catch (cause: unknown) {
    error.value = cause;
    toast.error(t('settings.s3.errors.test'));
  } finally {
    busy.value = null;
  }
}

async function clearConfiguration(): Promise<void> {
  const revision = summary.value?.revision;
  if (!control?.clearS3StorageConfiguration || revision === null || revision === undefined) return;
  busy.value = 'clear';
  error.value = null;
  try {
    await control.clearS3StorageConfiguration(revision);
    summary.value = null;
    Object.assign(model, {
      endpoint: '',
      region: 'auto',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      sessionToken: null,
      pathStyle: true,
      rootPrefix: 'one-vegetable/gallery'
    });
    remark.value = null;
    toast.success(t('settings.s3.cleared'));
  } catch (cause: unknown) {
    error.value = cause;
    toast.error(t('settings.s3.errors.clear'));
  } finally {
    busy.value = null;
    confirmClear.value = false;
  }
}
</script>

<template>
  <Card class="p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <Cloud class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('settings.s3.title') }}</h2>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">{{ t('settings.s3.description') }}</p>
      </div>
      <span class="rounded-full bg-muted px-3 py-1 text-xs">
        {{ summary?.configured ? t('settings.s3.configured') : t('settings.s3.notConfigured') }}
      </span>
    </div>

    <p v-if="!supported" class="mt-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
      {{ t('settings.s3.unsupported') }}
    </p>
    <div v-else class="mt-4 grid gap-4 sm:grid-cols-2">
      <label class="text-sm font-medium sm:col-span-2">
        {{ t('settings.s3.endpoint') }}
        <Input v-model="model.endpoint" class="mt-2" placeholder="https://account.r2.cloudflarestorage.com" />
      </label>
      <label class="text-sm font-medium">
        {{ t('settings.s3.region') }}
        <Input v-model="model.region" class="mt-2" placeholder="auto" />
      </label>
      <label class="text-sm font-medium">
        {{ t('settings.s3.bucket') }}
        <Input v-model="model.bucket" class="mt-2" />
      </label>
      <label class="text-sm font-medium">
        {{ t('settings.s3.accessKey') }}
        <Input v-model="model.accessKeyId" class="mt-2" autocomplete="off" data-feedback-redact />
      </label>
      <label class="text-sm font-medium">
        {{ t('settings.s3.secretKey') }}
        <Input
          v-model="model.secretAccessKey"
          class="mt-2"
          type="password"
          autocomplete="new-password"
          data-feedback-redact
        />
      </label>
      <label class="text-sm font-medium sm:col-span-2">
        {{ t('settings.s3.sessionToken') }}
        <Input
          :model-value="model.sessionToken ?? ''"
          class="mt-2"
          type="password"
          autocomplete="new-password"
          data-feedback-redact
          @update:model-value="model.sessionToken = String($event)"
        />
      </label>
      <label class="text-sm font-medium sm:col-span-2">
        {{ t('settings.s3.rootPrefix') }}
        <Input v-model="model.rootPrefix" class="mt-2" />
      </label>
      <label class="flex cursor-pointer items-center gap-2 text-sm font-medium sm:col-span-2">
        <input v-model="model.pathStyle" class="size-4 accent-primary" type="checkbox" />
        {{ t('settings.s3.pathStyle') }}
      </label>
      <p v-if="summary?.configured" class="text-xs text-muted-foreground sm:col-span-2">
        {{ t('settings.s3.secretHint', { suffix: summary.accessKeyIdSuffix ?? '—' }) }}
      </p>
      <ErrorNotice v-if="error" class="sm:col-span-2" :error="error" compact />
      <div class="flex flex-wrap gap-2 sm:col-span-2">
        <Button :disabled="!canSave" @click="save">
          <LoaderCircle v-if="busy === 'save'" class="size-4 animate-spin" />
          <Save v-else class="size-4" />
          {{ t('settings.s3.save') }}
        </Button>
        <Button variant="outline" :disabled="busy !== null || !summary?.configured" @click="testConnection">
          <LoaderCircle v-if="busy === 'test'" class="size-4 animate-spin" />
          <Unplug v-else class="size-4" />
          {{ t('settings.s3.test') }}
        </Button>
        <Button
          variant="outline"
          :disabled="busy !== null || !summary?.configured"
          @click="confirmClear = true"
        >
          <Trash2 class="size-4" />{{ t('settings.s3.clear') }}
        </Button>
      </div>
    </div>
    <GalleryImportRulesSettings v-if="supported" />
  </Card>

  <ConfirmActionDialog
    v-model:open="confirmClear"
    :title="t('settings.s3.clearTitle')"
    :description="t('settings.s3.clearDescription')"
    :confirm-label="t('settings.s3.clear')"
    destructive
    @confirm="clearConfiguration"
  />
</template>
