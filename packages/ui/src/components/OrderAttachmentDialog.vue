<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { FileUp, FolderOpen, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { GatewayException } from '@one-vegetable/core/errors';
import type { EncodedFilePayload } from '@one-vegetable/core/encoded-file';
import {
  ORDER_ATTACHMENT_LIMIT,
  createOrderAttachmentFile,
  validateOrderAttachmentFile
} from '@one-vegetable/core/order-attachment-platform';
import type { OrderAttachmentReceipt } from '@one-vegetable/core/order-attachments';
import { ORDER_ATTACHMENT_METHOD } from '@one-vegetable/core/order-fulfillment-methods';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { useOrderAttachmentsI18n } from '../i18n/order-attachments';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';

const props = withDefaults(
  defineProps<{
    open?: boolean;
    source?: { name: string; load: () => Promise<EncodedFilePayload> };
  }>(),
  { open: true, source: undefined }
);
const emit = defineEmits<{ close: [] }>();
const at = useOrderAttachmentsI18n();
const services = useServices();
const identity = useListIdentityScope();
const input = ref<HTMLInputElement | null>(null);
const file = shallowRef<EncodedFilePayload | null>(null);
const sha256 = ref('');
const preparing = ref(false);
const sending = ref(false);
const confirming = ref(false);
const receipt = shallowRef<OrderAttachmentReceipt | null>(null);
const attemptId = ref('');
const error = shallowRef<unknown>(null);
let generation = 0;
let disposed = false;
const available = computed(() => !!services.orderAttachments && !!services.gateway.galleryTransferContext);
const blocked = computed(() => preparing.value || sending.value);
function reset(): void {
  generation++;
  file.value = null;
  sha256.value = '';
  confirming.value = false;
  receipt.value = null;
  error.value = null;
  preparing.value = false;
  sending.value = false;
}
watch(() => [props.open, props.source, identity.value], reset);
onBeforeUnmount(() => {
  disposed = true;
  reset();
});
async function prepare(load: () => Promise<EncodedFilePayload>): Promise<void> {
  if (blocked.value || attemptId.value) return;
  reset();
  preparing.value = true;
  const version = generation;
  try {
    const value = await load();
    const bytes = validateOrderAttachmentFile(value);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
    if (disposed || version !== generation) return;
    file.value = value;
    sha256.value = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch (cause) {
    if (!disposed && version === generation) error.value = cause;
  } finally {
    if (!disposed && version === generation) preparing.value = false;
  }
}
function choose(event: Event): void {
  const target = event.target as HTMLInputElement;
  const picked = target.files?.[0];
  target.value = '';
  if (!picked) return;
  void prepare(async () => {
    if (!picked.size || picked.size > ORDER_ATTACHMENT_LIMIT)
      throw new GatewayException({
        code: 'ORDER_ATTACHMENT_FILE_INVALID',
        message: 'ORDER_ATTACHMENT_FILE_INVALID',
        retryable: false
      });
    const bytes = new Uint8Array(await picked.arrayBuffer());
    return createOrderAttachmentFile(picked.name, bytes);
  });
}
async function upload(): Promise<void> {
  const currentFile = file.value;
  const control = services.orderAttachments;
  const contextQuery = services.gateway.galleryTransferContext?.bind(services.gateway);
  if (blocked.value || !currentFile || !control || !contextQuery || receipt.value) return;
  confirming.value = false;
  sending.value = true;
  const version = generation;
  const stale = () => disposed || version !== generation;
  try {
    const payload = { method: ORDER_ATTACHMENT_METHOD, parameters: { file_name: currentFile.fileName } };
    const context = await contextQuery('callCapability', payload);
    if (stale()) return;
    attemptId.value = globalThis.crypto.randomUUID();
    const result = await control.upload({ requestId: attemptId.value, file: currentFile, context });
    if (stale()) return;
    receipt.value = result;
    file.value = null;
    if (result.status === 'accepted') toast.success(at('accepted'));
    else if (result.status === 'unknown' || result.status === 'sending') toast.warning(at('unknown'));
    else toast.error(at('failed'));
  } catch (cause) {
    if (!disposed && version === generation) {
      if (
        cause instanceof GatewayException &&
        [
          'ORDER_ATTACHMENT_UPLOAD_DISABLED',
          'ORDER_ATTACHMENT_FILE_INVALID',
          'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
          'GALLERY_CONTEXT_CHANGED',
          'REQUEST_CONTRACT_INVALID',
          'ADMIN_REQUIRED'
        ].includes(cause.gatewayError.code)
      )
        attemptId.value = '';
      error.value = cause;
    }
  } finally {
    if (!disposed && version === generation) sending.value = false;
  }
}
async function query(): Promise<void> {
  const jobId = receipt.value?.jobId ?? attemptId.value;
  if (!jobId || !services.orderAttachments || blocked.value) return;
  const version = generation;
  preparing.value = true;
  try {
    const value = await services.orderAttachments.get({ requestId: globalThis.crypto.randomUUID(), jobId });
    if (!disposed && version === generation) {
      receipt.value = value;
      error.value = null;
      file.value = null;
    }
  } catch (cause) {
    if (!disposed && version === generation) error.value = cause;
  } finally {
    if (!disposed && version === generation) preparing.value = false;
  }
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="at('title')"
    :description="at('description')"
    :dismissible="!sending"
    @update:open="
      (value) => {
        if (!value) emit('close');
      }
    "
  >
    <div class="space-y-4">
      <p class="text-sm text-muted-foreground">{{ at('limits') }}</p>
      <p v-if="!available" role="status" class="text-sm text-muted-foreground">{{ at('unavailable') }}</p>
      <template v-if="!receipt && !attemptId">
        <input
          ref="input"
          type="file"
          accept=".jpg,.jpeg,.png,.pdf,.doc"
          class="sr-only"
          :aria-label="at('select')"
          @change="choose"
        />
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" :disabled="blocked" @click="input?.click()"
            ><FolderOpen class="mr-2 size-4 shrink-0" />{{ at('select') }}</Button
          >
          <Button v-if="source" variant="outline" :disabled="blocked" @click="prepare(source.load)"
            ><FileUp class="mr-2 size-4 shrink-0" />{{ at('read') }}</Button
          >
        </div>
        <p v-if="source" class="break-all text-sm" data-feedback-redact>{{ source.name }}</p>
        <p v-if="preparing" role="status" class="text-sm">{{ at('preparing') }}</p>
      </template>
      <dl
        v-if="file || receipt"
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
        data-feedback-redact
      >
        <dt class="text-muted-foreground">{{ at('fileName') }}</dt>
        <dd class="break-all">{{ receipt?.fileName ?? file?.fileName }}</dd>
        <dt class="text-muted-foreground">{{ at('size') }}</dt>
        <dd>{{ receipt?.size ?? file?.byteLength }} B</dd>
        <dt class="text-muted-foreground">{{ at('fingerprint') }}</dt>
        <dd class="break-all font-mono text-xs">{{ receipt?.sha256 ?? sha256 }}</dd>
      </dl>
      <div v-if="receipt" class="space-y-2 rounded-md border p-3 text-sm" role="status">
        <p>
          {{
            receipt.status === 'accepted'
              ? at('accepted')
              : receipt.status === 'failed'
                ? at('failed')
                : at('unknown')
          }}
        </p>
        <p v-if="receipt.status === 'accepted'" class="text-muted-foreground">{{ at('acceptedNote') }}</p>
        <p class="break-all font-mono text-xs">{{ at('requestId') }}: {{ receipt.requestId }}</p>
        <p v-if="receipt.platformReference" class="break-all" data-feedback-redact>
          {{ at('reference') }}: {{ receipt.platformReference }}
        </p>
        <Button variant="outline" :disabled="blocked" @click="query">{{ at('query') }}</Button>
      </div>
      <ErrorNotice v-if="error" :error="error" />
      <div v-if="attemptId && !receipt" class="space-y-2 text-sm" role="status">
        <p>{{ at('unknown') }}</p>
        <p class="break-all font-mono text-xs">{{ at('requestId') }}: {{ attemptId }}</p>
        <Button variant="outline" :disabled="blocked" @click="query">{{ at('query') }}</Button>
      </div>
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" :disabled="sending" @click="emit('close')">{{ at('close') }}</Button>
        <Button
          v-if="!receipt && !attemptId"
          :disabled="!available || !file || blocked"
          @click="confirming = true"
          ><Upload class="mr-2 size-4 shrink-0" />{{ sending ? at('busy') : at('upload') }}</Button
        >
      </div>
    </template>
  </ModalDialog>
  <ConfirmActionDialog
    v-model:open="confirming"
    :title="at('confirm')"
    :description="at('confirmation')"
    :confirm-label="at('upload')"
    :pending="sending"
    @confirm="upload"
  />
</template>
