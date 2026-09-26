<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { toast } from 'vue-sonner';
import { GatewayException } from '@one-vegetable/core/errors';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import {
  fingerprintVideoFile,
  verifyReselectedVideo,
  VideoUploadError,
  type VideoUploadFile,
  type VideoUploadResult,
  type VideoUploadTask
} from '@one-vegetable/core/video-upload';
import { useServices } from '../lib/services';
import { VideoUploadRunner, sameVideoContext } from '../lib/video-upload-runner';
import { formatDateTime } from '../lib/date-time';
import { useVideoI18n } from '../i18n/video';
import { useUiI18n } from '../i18n';
import type { VideoProductTarget } from '../lib/video-library';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  'update:open': [value: boolean];
  confirmed: [];
  associate: [target: VideoProductTarget];
}>();
const services = useServices();
const uploadCall =
  services.videoUploads?.videoUpload.bind(services.videoUploads) ??
  services.s3Storage?.videoUpload?.bind(services.s3Storage) ??
  services.control?.videoUpload?.bind(services.control);
const control = uploadCall ? { videoUpload: uploadCall } : undefined;
const vt = useVideoI18n();
const { t } = useUiI18n();
const tasks = shallowRef<VideoUploadTask[]>([]);
const context = shallowRef<GalleryTransferContext | null>(null);
const enabled = ref(false),
  busy = ref(false),
  loading = ref(false),
  hashing = ref(false);
const selectedId = ref(''),
  title = ref(''),
  source = ref<'file' | 'url'>('file'),
  sourceUrl = ref('');
const file = shallowRef<File | null>(null),
  fingerprint = shallowRef<VideoUploadFile | null>(null);
const errorCode = ref(''),
  storageCode = ref(''),
  requestId = ref('');
const confirmation = ref<'create' | 'stage' | 'submit' | 'cancel' | null>(null);
const selected = computed(() => tasks.value.find((task) => task.id === selectedId.value) ?? null);
const matching = computed(
  () => !!selected.value && !!context.value && sameVideoContext(selected.value.context, context.value)
);
const validUrl = computed(() => {
  try {
    const url = new URL(sourceUrl.value.trim());
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
});
const canCreate = computed(
  () =>
    !!title.value.trim() &&
    !!context.value &&
    !!control &&
    enabled.value &&
    (source.value === 'file' ? !!fingerprint.value : validUrl.value)
);
const canSubmit = computed(
  () =>
    matching.value &&
    enabled.value &&
    selected.value &&
    ((selected.value.source === 'file' && selected.value.status === 'staged') ||
      (selected.value.source === 'url' && selected.value.status === 'prepared' && validUrl.value))
);
let runner: VideoUploadRunner | null = null;
let generation = 0;

const statuses = {
  prepared: 'uploadPrepared',
  staging: 'uploadStaging',
  staged: 'uploadStaged',
  submitting: 'uploadSubmitting',
  accepted: 'uploadAccepted',
  'needs-review': 'uploadNeedsReview',
  confirmed: 'uploadConfirmed',
  cancelled: 'uploadCancelled',
  failed: 'uploadFailed'
} as const;

function accept(result: VideoUploadResult): void {
  enabled.value = result.uploadEnabled;
  const combined = new Map(tasks.value.map((task) => [task.id, task]));
  for (const task of result.tasks) combined.set(task.id, task);
  tasks.value = [...combined.values()].sort((a, b) => b.createTimeUtc - a.createTimeUtc);
}
function fail(error: unknown): void {
  // Never show arbitrary provider text: it may contain a signed source URL.
  const value =
    error instanceof GatewayException
      ? error.gatewayError.code
      : error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
  errorCode.value =
    typeof value === 'string' && /^[A-Z][A-Z_0-9]{0,99}$/u.test(value) ? value : 'VIDEO_UPLOAD_FAILED';
  const detail = error instanceof GatewayException ? error.gatewayError.subCode : undefined;
  storageCode.value =
    errorCode.value === 'S3_REQUEST_FAILED' &&
    typeof detail === 'string' &&
    /^HTTP_\d{3}:[A-Za-z]{1,50}$/u.test(detail)
      ? detail
      : '';
  const id = error && typeof error === 'object' && 'requestId' in error ? error.requestId : undefined;
  requestId.value = typeof id === 'string' && /^[\da-f-]{36}$/iu.test(id) ? id : '';
}
async function currentContext(): Promise<GalleryTransferContext> {
  if (!services.gateway.galleryTransferContext) throw new VideoUploadError('VIDEO_UPLOAD_UNAVAILABLE');
  return services.gateway.galleryTransferContext();
}
async function load(): Promise<void> {
  if (!control || busy.value) return;
  const ticket = generation;
  loading.value = true;
  errorCode.value = '';
  try {
    const next = await currentContext();
    const result = await control.videoUpload({ action: 'list' }, next);
    if (ticket !== generation || !props.open) return;
    context.value = next;
    tasks.value = [];
    accept(result);
  } catch (error) {
    if (ticket === generation) fail(error);
  } finally {
    if (ticket === generation) loading.value = false;
  }
}
function stop(): void {
  runner?.stop();
}
function close(): void {
  stop();
  emit('update:open', false);
}
function clearSource(): void {
  file.value = null;
  fingerprint.value = null;
  sourceUrl.value = '';
  errorCode.value = '';
  requestId.value = '';
}
function chooseTask(id: string): void {
  if (busy.value) return;
  selectedId.value = id;
  clearSource();
}
async function chooseFile(event: Event): Promise<void> {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  const chosen = input?.files?.[0];
  if (input) input.value = '';
  file.value = null;
  fingerprint.value = null;
  if (!chosen) return;
  const ticket = generation,
    taskId = selectedId.value;
  hashing.value = true;
  errorCode.value = '';
  try {
    const result = selected.value
      ? await verifyReselectedVideo(chosen, selected.value)
      : await fingerprintVideoFile(chosen);
    if (ticket !== generation || taskId !== selectedId.value) return;
    file.value = chosen;
    fingerprint.value = result;
  } catch (error) {
    if (ticket === generation) fail(error);
  } finally {
    hashing.value = false;
  }
}
async function run(action: (active: VideoUploadRunner) => Promise<void>): Promise<void> {
  if (busy.value || !control || !context.value) return;
  const active = new VideoUploadRunner(control, context.value, currentContext, accept);
  runner = active;
  busy.value = true;
  errorCode.value = '';
  requestId.value = '';
  try {
    await action(active);
  } catch (error) {
    if (!(error instanceof VideoUploadError && error.code === 'VIDEO_UPLOAD_PAUSED')) fail(error);
    // Read a durable receipt after any error; never repeat the failed write.
    if (selectedId.value && props.open) {
      try {
        accept(await control.videoUpload({ action: 'get', taskId: selectedId.value }, context.value));
      } catch {
        /* Keep the last known receipt, not an invented success. */
      }
    }
  } finally {
    busy.value = false;
    if (runner === active) runner = null;
  }
}
async function executeConfirmation(): Promise<void> {
  const action = confirmation.value;
  confirmation.value = null;
  const original = selected.value,
    chosen = file.value,
    url = sourceUrl.value.trim();
  await run(async (active) => {
    if (action === 'create') {
      const result = await active.call({
        action: 'create',
        title: title.value.trim(),
        source:
          source.value === 'file' && fingerprint.value
            ? { kind: 'file', file: fingerprint.value }
            : { kind: 'url', url }
      });
      const created = result.tasks[0];
      if (!created) throw new VideoUploadError('VIDEO_UPLOAD_RESPONSE_INVALID');
      selectedId.value = created.id;
      if (created.source === 'file' && chosen) await active.stage(created, chosen);
    } else if (original && action === 'stage' && chosen) {
      await active.stage(original, chosen);
    } else if (original && action === 'submit') {
      const accepted = await active.submit(original, url);
      if (props.open) toast.info(vt('uploadAcceptedHint'));
      const checked = await active.verifyUntilSettled(accepted);
      if (checked.status === 'confirmed') {
        emit('confirmed');
        if (props.open) toast.success(vt('uploadConfirmed'));
      }
    } else if (original && action === 'cancel') {
      await active.command(original, 'cancel');
    }
  });
}
async function inspect(action: 'reconcile' | 'verify'): Promise<void> {
  const task = selected.value;
  if (!task) return;
  await run(async (active) => {
    const checked = await active.command(task, action);
    if (checked.status === 'confirmed') {
      emit('confirmed');
      toast.success(vt('uploadConfirmed'));
    }
  });
}
async function useInProduct(): Promise<void> {
  const task = selected.value,
    ticket = generation;
  if (busy.value || !matching.value || task?.status !== 'confirmed' || !task.videoId) return;
  busy.value = true;
  try {
    const current = await currentContext();
    if (ticket !== generation || !props.open || selectedId.value !== task.id) return;
    if (!sameVideoContext(current, task.context)) {
      context.value = current;
      throw new VideoUploadError('GALLERY_TASK_CONTEXT_CHANGED');
    }
    emit('associate', {
      videoId: task.videoId,
      identity: JSON.stringify([current.identity, current.gateway])
    });
    close();
  } catch (error) {
    if (ticket === generation) fail(error);
  } finally {
    busy.value = false;
  }
}
async function checkIdentity(): Promise<void> {
  if (!props.open || !context.value) return;
  try {
    if (sameVideoContext(context.value, await currentContext())) return;
    stop();
    generation++;
    context.value = null;
    clearSource();
    errorCode.value = 'GALLERY_TASK_CONTEXT_CHANGED';
  } catch (error) {
    stop();
    fail(error);
  }
}
const focus = () => {
  void checkIdentity();
};
watch(
  () => props.open,
  (open) => {
    generation++;
    confirmation.value = null;
    if (open) {
      void load();
      globalThis.addEventListener('focus', focus);
    } else {
      stop();
      clearSource();
      loading.value = false;
      globalThis.removeEventListener('focus', focus);
    }
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  generation++;
  stop();
  clearSource();
  globalThis.removeEventListener('focus', focus);
});
</script>

<template>
  <ModalDialog
    :open="open"
    :title="vt('uploadTitle')"
    :description="vt('uploadNotice')"
    size="lg"
    @update:open="close"
  >
    <p v-if="!control" role="status">{{ vt('uploadUnavailable') }}</p>
    <div v-else class="space-y-4">
      <p class="rounded-md bg-muted p-3 text-sm">{{ vt('uploadResumeHint') }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" :disabled="busy || loading" @click="chooseTask('')">{{
          vt('uploadNew')
        }}</Button>
        <Button variant="outline" :disabled="busy || loading" @click="load">{{ vt('uploadRefresh') }}</Button>
        <Button v-if="busy" variant="outline" @click="stop">{{ vt('uploadPause') }}</Button>
        <span v-if="loading || hashing || busy" role="status" class="text-sm text-muted-foreground">{{
          hashing ? vt('uploadHashing') : busy ? vt('uploadRunning') : vt('loading')
        }}</span>
      </div>
      <label v-if="tasks.length" class="grid gap-1 text-sm"
        >{{ vt('uploadTasks') }}
        <select
          :value="selectedId"
          :disabled="busy"
          class="rounded-md border bg-background p-2"
          @change="chooseTask(($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ vt('uploadNew') }}</option>
          <option v-for="task in tasks" :key="task.id" :value="task.id">
            {{ task.title }} · {{ vt(statuses[task.status]) }}
          </option>
        </select>
      </label>
      <template v-if="!selected">
        <label class="grid gap-1 text-sm"
          >{{ vt('titleSearch') }}<Input v-model="title" :disabled="busy" maxlength="180"
        /></label>
        <label class="grid gap-1 text-sm"
          >{{ vt('uploadSource')
          }}<select v-model="source" :disabled="busy" class="rounded-md border bg-background p-2">
            <option value="file">{{ vt('uploadFile') }}</option>
            <option value="url">{{ vt('uploadUrl') }}</option>
          </select></label
        >
      </template>
      <template v-else>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 break-all text-sm">
          <dt>{{ vt('uploadTaskId') }}</dt>
          <dd>{{ selected.id }}</dd>
          <dt>{{ vt('titleSearch') }}</dt>
          <dd>{{ selected.title }}</dd>
          <dt>{{ vt('uploadState') }}</dt>
          <dd>{{ vt(statuses[selected.status]) }}</dd>
          <dt>{{ vt('uploadUpdated') }}</dt>
          <dd class="whitespace-nowrap">{{ formatDateTime(selected.updateTimeUtc) }}</dd>
          <template v-if="selected.file"
            ><dt>{{ vt('uploadFile') }}</dt>
            <dd>{{ selected.file.fileName }} · {{ selected.file.byteLength }} B</dd>
            <dt>{{ vt('uploadParts') }}</dt>
            <dd>
              {{ selected.parts.filter((part) => part.status === 'confirmed').length }} /
              {{ selected.parts.length }}
            </dd></template
          >
          <template v-if="selected.videoId"
            ><dt>{{ vt('idSearch') }}</dt>
            <dd>{{ selected.videoId }}</dd></template
          >
          <template v-if="selected.requestId"
            ><dt>requestId</dt>
            <dd>{{ selected.requestId }}</dd></template
          >
          <template v-if="selected.traceId"
            ><dt>traceId</dt>
            <dd>{{ selected.traceId }}</dd></template
          >
        </dl>
        <p v-if="!matching" role="alert" class="text-sm text-destructive">{{ vt('uploadContextChanged') }}</p>
        <p
          v-if="['accepted', 'submitting', 'needs-review'].includes(selected.status)"
          class="rounded-md bg-muted p-3 text-sm"
        >
          {{
            vt(
              selected.reasonCode === 'VIDEO_CANCELLATION_PENDING'
                ? 'uploadCancellationPending'
                : 'uploadAcceptedHint'
            )
          }}
        </p>
        <details v-if="selected.reasonCode" class="text-xs">
          <summary>{{ vt('issues') }}</summary>
          <code>{{ selected.reasonCode }}</code>
        </details>
      </template>
      <fieldset :disabled="busy || hashing || (!!selected && !matching)" class="space-y-3">
        <label
          v-if="
            (selected?.source ?? source) === 'file' &&
            (!selected || ['prepared', 'staging', 'needs-review'].includes(selected.status))
          "
          class="grid gap-1 text-sm"
        >
          {{ selected ? vt('uploadReselect') : vt('uploadFile') }}
          <input type="file" accept="video/mp4,.mp4" @change="chooseFile" />
          <span v-if="fingerprint"
            >{{ fingerprint.fileName }} · {{ fingerprint.byteLength }} B ·
            {{ vt('uploadFingerprintReady') }}</span
          >
        </label>
        <label
          v-if="(selected?.source ?? source) === 'url' && (!selected || selected.status === 'prepared')"
          class="grid gap-1 text-sm"
          >{{ vt('uploadUrl')
          }}<Input v-model="sourceUrl" type="url" autocomplete="off" data-feedback-redact /><span
            class="text-xs text-muted-foreground"
            >{{ vt('uploadUrlHint') }}</span
          ></label
        >
        <div class="flex flex-wrap gap-2">
          <Button v-if="!selected" :disabled="!canCreate || loading" @click="confirmation = 'create'">{{
            vt('uploadPrepare')
          }}</Button>
          <template v-else>
            <Button
              v-if="selected.status === 'confirmed' && selected.videoId"
              data-testid="upload-use-in-product"
              variant="outline"
              @click="useInProduct"
              >{{ vt('useInProduct') }}</Button
            >
            <Button
              v-if="selected.source === 'file' && ['prepared', 'staging'].includes(selected.status)"
              :disabled="!file || !enabled"
              @click="confirmation = 'stage'"
              >{{ vt('uploadContinue') }}</Button
            >
            <Button
              v-if="['prepared', 'staged'].includes(selected.status)"
              :disabled="!canSubmit"
              :title="!enabled ? vt('uploadDisabled') : undefined"
              @click="confirmation = 'submit'"
              >{{ vt('uploadSubmit') }}</Button
            >
            <Button
              v-if="selected.source === 'file' && ['staging', 'needs-review'].includes(selected.status)"
              variant="outline"
              @click="inspect('reconcile')"
              >{{ vt('uploadReconcile') }}</Button
            >
            <Button
              v-if="
                ['accepted', 'submitting', 'needs-review'].includes(selected.status) &&
                selected.reasonCode !== 'VIDEO_CANCELLATION_PENDING'
              "
              variant="outline"
              @click="inspect('verify')"
              >{{ vt('uploadVerify') }}</Button
            >
            <Button
              v-if="['prepared', 'staging'].includes(selected.status)"
              variant="outline"
              :disabled="!enabled"
              @click="confirmation = 'cancel'"
              >{{ vt('uploadCancel') }}</Button
            >
          </template>
        </div>
      </fieldset>
      <p v-if="!enabled && context" class="text-sm text-muted-foreground">{{ vt('uploadDisabled') }}</p>
      <div v-if="errorCode" role="alert" class="rounded-md border border-destructive p-3 text-sm">
        <p v-if="errorCode === 'S3_REQUEST_FAILED'">
          {{
            t(
              storageCode === 'HTTP_411:MissingContentLength'
                ? 'errors.codes.S3_CONTENT_LENGTH_REQUIRED'
                : 'errors.codes.S3_REQUEST_FAILED'
            )
          }}
        </p>
        <p v-else>
          {{
            vt(
              errorCode === 'VIDEO_FILE_CHANGED'
                ? 'uploadFileChanged'
                : errorCode === 'VIDEO_FILE_INVALID'
                  ? 'uploadFileInvalid'
                  : 'uploadError'
            )
          }}
        </p>
        <details class="mt-2 break-all text-xs">
          <summary>{{ vt('issues') }}</summary>
          <p>{{ errorCode }}</p>
          <p v-if="storageCode">{{ storageCode }}</p>
          <p v-if="requestId">requestId: {{ requestId }}</p>
        </details>
      </div>
    </div>
  </ModalDialog>
  <ModalDialog
    :open="confirmation !== null"
    :title="vt('uploadConfirm')"
    :description="
      vt(
        confirmation === 'submit'
          ? 'uploadConfirmSubmit'
          : confirmation === 'cancel'
            ? 'uploadConfirmCancel'
            : 'uploadConfirmPrepare'
      )
    "
    size="sm"
    @update:open="confirmation = null"
  >
    <p class="mt-3 break-all font-medium">{{ selected?.title ?? title }}</p>
    <template #footer
      ><div class="flex justify-end gap-2">
        <Button variant="outline" @click="confirmation = null">{{ t('common.actions.cancel') }}</Button
        ><Button @click="executeConfirmation">{{ t('common.actions.confirm') }}</Button>
      </div></template
    >
  </ModalDialog>
</template>
