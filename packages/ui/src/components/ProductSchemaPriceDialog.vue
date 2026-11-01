<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { toast } from 'vue-sonner';
import type { ProductMutationJob, ProductSchemaUpdateRequest } from '@one-vegetable/core';
import {
  ProductReferenceClient,
  IOP_REFERENCE_METHODS,
  type ProductReference
} from '@one-vegetable/core/product-reference';
import {
  validateProductPriceDraft,
  type ProductPriceDraft
} from '@one-vegetable/core/product-maintenance-api';
import { prepareProductSchemaPrice } from '@one-vegetable/core/product-schema-price';
import {
  requireProductOperationContext,
  type ProductOperationContext
} from '@one-vegetable/core/product-operation-context';
import { GatewayException } from '@one-vegetable/core/errors';
import { createRequestId } from '@one-vegetable/core/network';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { useProductValueMaintenanceI18n } from '../i18n/product-value-maintenance';
import ModalDialog from './ui/ModalDialog.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';

const props = defineProps<{ productId: string }>();
const emit = defineEmits<{ close: [] }>();
const services = useServices();
const identity = useListIdentityScope();
const pm = useProductValueMaintenanceI18n();
const reference = shallowRef<ProductReference | null>(null);
const context = shallowRef<ProductOperationContext | null>(null);
const xml = ref('');
const rows = ref<{ quantity: string; before: string; price: string }[]>([]);
const preview = shallowRef<Awaited<ReturnType<typeof prepareProductSchemaPrice>> | null>(null);
const job = shallowRef<ProductMutationJob | null>(null);
const busy = ref(false),
  loading = ref(false),
  attempted = ref(false),
  blocked = ref(false);
const confirmationOpen = ref(false),
  pollingStopped = ref(false);
const error = shallowRef<unknown>(null);
const requestId = ref('');
let sequence = 0,
  alive = true,
  closed = false,
  pollUntil = 0;
let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

const draft = computed<ProductPriceDraft>(() => ({
  operation: 'setPrice',
  productId: props.productId,
  mode: 'tiered',
  currency: 'USD',
  tiers: rows.value.map(({ quantity, price }) => ({ quantity, price }))
}));
const signature = computed(() => JSON.stringify(draft.value));
const available = computed(() => Boolean(services.productMutationJobs));
const editable = computed(() =>
  Boolean(reference.value && !busy.value && !attempted.value && !blocked.value)
);
const canPreview = computed(() => editable.value && validateProductPriceDraft(draft.value));
const canSend = computed(() => Boolean(canPreview.value && preview.value && !preview.value.unchanged));
const pending = computed(() =>
  Boolean(job.value && ['submitted', 'auditing', 'verifying'].includes(job.value.status))
);
const canRefresh = computed(() =>
  Boolean(
    job.value &&
    context.value &&
    !busy.value &&
    !blocked.value &&
    globalThis.document.visibilityState !== 'hidden' &&
    !['verified', 'failed', 'recovered'].includes(job.value.status)
  )
);
const taskHref = computed(() =>
  job.value ? '#/products/tasks/' + encodeURIComponent(job.value.id) : '#/products/tasks'
);
type MessageKey = Parameters<typeof pm>[0];
const jobLabels: Record<ProductMutationJob['status'], MessageKey> = {
  submitted: 'schemaSubmitted',
  auditing: 'schemaAuditing',
  verifying: 'schemaVerifying',
  verified: 'verified',
  failed: 'schemaFailed',
  'recovery-required': 'schemaRecovery',
  recovering: 'schemaRecovery',
  recovered: 'schemaRecovery'
};
const stableCode = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value) ? value : '';
const code = computed(() =>
  stableCode(
    error.value instanceof GatewayException
      ? error.value.gatewayError.code
      : error.value instanceof Error
        ? error.value.message
        : job.value?.reasonCode
  )
);
function hint(value: string): MessageKey {
  if (value === 'PRODUCT_SCHEMA_PRICE_INTEGRITY_MISMATCH') return 'nonTargetChangedHint';
  if (value === 'PRODUCT_SCHEMA_PRICE_READBACK_UNAVAILABLE') return 'integrityUnavailableHint';
  if (value === 'PRODUCT_SCHEMA_PRICE_REVIEW_PENDING') return 'reviewPendingHint';
  if (/SCHEMA_INVALID|PATCH_UNSAFE|READ_ONLY/u.test(value)) return 'schemaUnsupported';
  if (/BASELINE_UNAVAILABLE|MODEL_UNAVAILABLE/u.test(value)) return 'integrityUnavailableHint';
  if (/REFERENCE_MISMATCH|PATCH_MISMATCH|GUARD_INVALID/u.test(value)) return 'schemaBaselineChanged';
  if (value.includes('IDENTITY_MISMATCH')) return 'schemaContextChanged';
  if (/IOP.*(?:REQUIRED|UNAVAILABLE)|AUTHORIZATION_REQUIRED/u.test(value)) return 'schemaIopRequired';
  if (/CONTEXT|PAUSED/u.test(value)) return 'schemaContextChanged';
  if (/NON_TARGET|INTEGRITY/u.test(value)) return 'integrityUnavailableHint';
  if (/BASELINE|FINGERPRINT|STALE/u.test(value)) return 'schemaBaselineChanged';
  if (/REVIEW|AUDIT|STATE/u.test(value)) return 'reviewPendingHint';
  if (/UNSUPPORTED|STRUCTURE|LAYOUT|PRICE_TYPE|CURRENCY|TIER|QUANTITY|SLOT|SCOPE/u.test(value))
    return 'schemaUnsupported';
  if (/INVALID|INPUT|AMOUNT/u.test(value)) return 'schemaInvalid';
  if (/PERMISSION|FORBIDDEN|RESTRICTED/iu.test(value)) return 'permissionDenied';
  if (/BUSY|BLOCKED/u.test(value)) return 'entityBusyHint';
  return 'schemaFailed';
}
function fail(value: string): never {
  throw new Error(value);
}
function stopPolling() {
  if (timer !== undefined) globalThis.clearTimeout(timer);
  timer = undefined;
}
function current(ticket: number) {
  return alive && !closed && ticket === sequence && !blocked.value;
}
function selectionPayload() {
  return { method: IOP_REFERENCE_METHODS.getProduct, parameters: { product_id: props.productId } };
}
async function selectContext() {
  if (!services.gateway.galleryTransferContext) return fail('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
  const value = await services.gateway.galleryTransferContext('callCapability', selectionPayload());
  return requireProductOperationContext({ identity: value.identity, gateway: value.gateway });
}
function sameContext(a: ProductOperationContext | null | undefined, b: ProductOperationContext) {
  return a?.identity === b.identity && a.gateway === b.gateway;
}
async function assertContext(ticket: number, expected: ProductOperationContext) {
  if (!current(ticket)) return false;
  const actual = await selectContext();
  if (!current(ticket)) return false;
  if (!sameContext(actual, expected)) {
    invalidate();
    return false;
  }
  return true;
}
function invalidate() {
  sequence++;
  stopPolling();
  blocked.value = true;
  busy.value = loading.value = confirmationOpen.value = false;
  reference.value = context.value = preview.value = null;
  rows.value = [];
  xml.value = '';
  error.value = new Error('PRODUCT_CONTEXT_CHANGED');
}
function close() {
  closed = true;
  sequence++;
  stopPolling();
  confirmationOpen.value = false;
  emit('close');
}
async function load() {
  const ticket = ++sequence;
  stopPolling();
  blocked.value = false;
  reference.value = context.value = preview.value = job.value = null;
  rows.value = [];
  xml.value = requestId.value = '';
  error.value = null;
  attempted.value = pollingStopped.value = false;
  loading.value = busy.value = true;
  try {
    if (!available.value) return fail('PRODUCT_MUTATION_JOB_UNAVAILABLE');
    if (!/^[1-9][0-9]{0,18}$/u.test(props.productId)) return fail('PRODUCT_SCHEMA_PRICE_INPUT_INVALID');
    const selected = await selectContext();
    if (!current(ticket)) return;
    const client = new ProductReferenceClient({
      request: (operation, payload) =>
        services.gateway.request(operation, payload, { productContext: selected })
    });
    const value = await client.getProduct(props.productId);
    if (!(await assertContext(ticket, selected))) return;
    const categoryId = Number(value.categoryId);
    if (
      !value.categoryId ||
      !Number.isSafeInteger(categoryId) ||
      categoryId <= 0 ||
      (value.language !== 'en_US' && value.language !== 'zh_CN')
    )
      return fail('PRODUCT_SCHEMA_PRICE_UNSUPPORTED');
    if (
      value.price.type !== 'TIERED' ||
      value.price.currency !== 'USD' ||
      !value.price.tiers.length ||
      value.price.tiers.some((row) => row.quantity === null || row.price === null)
    )
      return fail('PRODUCT_SCHEMA_PRICE_UNSUPPORTED');
    const schema = await services.gateway.request(
      'renderProductSchema',
      {
        productId: value.productId,
        categoryId,
        language: value.language
      },
      { productContext: selected }
    );
    if (!(await assertContext(ticket, selected))) return;
    const initial = value.price.tiers.map((row) => ({
      quantity: row.quantity ?? fail('PRODUCT_SCHEMA_PRICE_UNSUPPORTED'),
      price: row.price ?? fail('PRODUCT_SCHEMA_PRICE_UNSUPPORTED')
    }));
    await prepareProductSchemaPrice(
      schema.xml,
      {
        operation: 'setPrice',
        productId: value.productId,
        mode: 'tiered',
        currency: 'USD',
        tiers: initial
      },
      value
    );
    if (!current(ticket)) return;
    context.value = selected;
    reference.value = value;
    xml.value = schema.xml;
    rows.value = initial.map((row) => ({ ...row, before: row.price }));
  } catch (value) {
    if (current(ticket)) error.value = value;
  } finally {
    if (current(ticket)) loading.value = busy.value = false;
  }
}
async function prepare() {
  if (!canPreview.value || !reference.value || !context.value) return;
  const ticket = sequence,
    input = signature.value,
    selected = context.value;
  busy.value = true;
  error.value = null;
  try {
    if (!(await assertContext(ticket, selected))) return;
    const result = await prepareProductSchemaPrice(xml.value, draft.value, reference.value);
    if (current(ticket) && input === signature.value) preview.value = result;
  } catch (value) {
    if (current(ticket)) error.value = value;
  } finally {
    if (current(ticket)) busy.value = false;
  }
}
function receiveJob(value: ProductMutationJob, expected: ProductOperationContext) {
  if (
    value.operation !== 'updateProduct' ||
    value.productId !== props.productId ||
    value.protocol !== 'iop' ||
    !sameContext(value.productContext, expected) ||
    (job.value && value.id !== job.value.id)
  )
    return fail('PRODUCT_CONTEXT_CHANGED');
  const wasVerified = job.value?.status === 'verified';
  job.value = value;
  if (value.status === 'verified' && !wasVerified) toast.success(pm('schemaVerified'));
}
function schedule(ticket: number) {
  stopPolling();
  if (!current(ticket) || !pending.value || globalThis.document.visibilityState === 'hidden') return;
  if (Date.now() + 5_000 > pollUntil) {
    pollingStopped.value = true;
    return;
  }
  timer = globalThis.setTimeout(() => {
    void refresh();
  }, 5_000);
}
async function refresh() {
  if (!canRefresh.value || !job.value || !context.value || !services.productMutationJobs) return;
  stopPolling();
  const ticket = sequence,
    selected = context.value,
    previous = job.value;
  busy.value = true;
  error.value = null;
  try {
    if (!(await assertContext(ticket, selected))) return;
    const value = await services.productMutationJobs.refresh(previous.id, previous.revision);
    if (!(await assertContext(ticket, selected))) return;
    receiveJob(value, selected);
    schedule(ticket);
  } catch (value) {
    if (current(ticket)) error.value = value;
  } finally {
    if (current(ticket)) busy.value = false;
  }
}
async function send() {
  if (!canSend.value || !preview.value || !reference.value || !context.value) return;
  const ticket = sequence,
    selected = context.value,
    prepared = preview.value;
  const input = signature.value,
    product = reference.value;
  confirmationOpen.value = false;
  busy.value = true;
  error.value = null;
  try {
    if (!(await assertContext(ticket, selected)) || input !== signature.value || prepared !== preview.value)
      return;
    const request: ProductSchemaUpdateRequest = {
      productId: product.productId,
      categoryId: Number(product.categoryId),
      language: product.language as ProductSchemaUpdateRequest['language'],
      schemaPatchXml: prepared.patchXml,
      priceGuard: prepared.guard
    };
    requestId.value = createRequestId();
    attempted.value = true;
    const result = await services.gateway.request('updateProduct', request, {
      productContext: selected,
      requestId: requestId.value
    });
    if (!(await assertContext(ticket, selected))) return;
    if (!result.job) return fail('PRODUCT_SCHEMA_PRICE_JOB_UNAVAILABLE');
    receiveJob(result.job, selected);
    pollUntil = Date.now() + 300_000;
    schedule(ticket);
  } catch (value) {
    if (current(ticket)) error.value = value;
  } finally {
    if (current(ticket)) busy.value = false;
  }
}
watch(
  signature,
  () => {
    preview.value = null;
    confirmationOpen.value = false;
  },
  { flush: 'sync' }
);
watch(identity, invalidate, { flush: 'sync' });
watch(() => props.productId, load, { immediate: true });
globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, invalidate);
function visibilityChanged() {
  if (globalThis.document.visibilityState === 'hidden') invalidate();
}
globalThis.document.addEventListener('visibilitychange', visibilityChanged);
onScopeDispose(() => {
  alive = false;
  sequence++;
  stopPolling();
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, invalidate);
  globalThis.document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>

<template>
  <ModalDialog
    :open="true"
    :title="pm('schemaTitle')"
    :description="pm('schemaHint')"
    @update:open="!$event && close()"
  >
    <div class="space-y-4 text-sm" :aria-busy="busy">
      <p class="break-all text-xs text-muted-foreground">{{ pm('product') }}: {{ productId }}</p>
      <p v-if="loading" role="status" data-result="loading">{{ pm('schemaLoading') }}</p>
      <form v-if="reference" class="space-y-3" @submit.prevent="prepare">
        <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>{{ pm('type') }}: {{ pm('tiered') }}</span>
          <span>{{ pm('currency') }}: USD</span>
        </div>
        <p class="text-xs text-muted-foreground">{{ pm('schemaFixedHint') }}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b">
                <th scope="col" class="p-2">{{ pm('quantity') }}</th>
                <th scope="col" class="p-2">{{ pm('schemaCurrent') }}</th>
                <th scope="col" class="p-2">{{ pm('schemaTarget') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in rows" :key="row.quantity" class="border-b last:border-0">
                <th scope="row" class="p-2 font-normal">{{ row.quantity }}</th>
                <td class="p-2 font-mono">{{ row.before }}</td>
                <td class="min-w-28 p-2">
                  <Input
                    v-model="row.price"
                    :data-field="'price-' + index"
                    :aria-label="pm('price') + ' · ' + pm('quantity') + ' ' + row.quantity"
                    :disabled="!editable"
                    inputmode="decimal"
                    autocomplete="off"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Button type="submit" data-action="preview" :disabled="!canPreview">{{ pm('schemaPreview') }}</Button>
        <p v-if="editable && !canPreview" class="text-xs text-muted-foreground">{{ pm('schemaInvalid') }}</p>
      </form>
      <section
        v-if="preview && !attempted"
        data-result="preview"
        class="space-y-2 rounded-md border p-3"
        aria-live="polite"
      >
        <p v-if="preview.unchanged" data-result="noop">{{ pm('schemaNoop') }}</p>
        <template v-else>
          <h3 class="font-medium">{{ pm('schemaDiff') }}</h3>
          <ul class="space-y-1">
            <li
              v-for="row in rows.filter((row) => row.before !== row.price)"
              :key="row.quantity"
              class="flex flex-wrap gap-2"
            >
              <span>{{ pm('quantity') }} {{ row.quantity }}:</span>
              <span class="font-mono">{{ row.before }} → {{ row.price }} USD</span>
            </li>
          </ul>
          <Button data-action="review" :disabled="!canSend" @click="confirmationOpen = true">{{
            pm('confirm')
          }}</Button>
        </template>
      </section>
      <section v-if="attempted" data-result="job" class="space-y-2 rounded-md border p-3" aria-live="polite">
        <p role="status" data-status>{{ job ? pm(jobLabels[job.status]) : pm('schemaUnknown') }}</p>
        <p
          v-if="
            job &&
            ['submitted', 'auditing', 'verifying'].includes(job.status) &&
            ['PRODUCT_SCHEMA_PRICE_REVIEW_PENDING', 'PRODUCT_SCHEMA_PRICE_READBACK_UNAVAILABLE'].includes(
              code
            )
          "
          data-error-hint
          class="text-xs text-muted-foreground"
        >
          {{ pm(hint(code)) }}
        </p>
        <p class="text-xs text-muted-foreground">{{ pm('schemaAttempted') }}</p>
        <p v-if="job" class="break-all text-xs">{{ pm('taskId') }}: {{ job.id }}</p>
        <p v-if="pollingStopped" role="status">{{ pm('schemaPollingStopped') }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <Button
            v-if="job && !['verified', 'failed', 'recovered'].includes(job.status)"
            variant="outline"
            data-action="refresh"
            :disabled="!canRefresh"
            @click="refresh"
            >{{ pm('schemaRefresh') }}</Button
          >
          <a
            :href="taskHref"
            data-action="task-center"
            class="rounded-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="close"
            >{{ pm('schemaTaskCenter') }}</a
          >
        </div>
      </section>
      <div
        v-if="error || (job && ['failed', 'recovery-required', 'recovering'].includes(job.status) && code)"
        role="alert"
        class="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
      >
        <p data-error-hint>{{ !available ? pm('unavailable') : pm(hint(code)) }}</p>
        <details v-if="code" class="text-xs">
          <summary class="cursor-pointer">{{ pm('technicalDetails') }}</summary>
          <code class="block break-all pt-2">{{ code }}</code>
          <p v-if="requestId" class="break-all pt-2">{{ pm('requestId') }}: {{ requestId }}</p>
        </details>
      </div>
      <p v-if="busy && !loading" role="status">{{ pm('busy') }}</p>
    </div>
    <template #footer
      ><Button variant="outline" data-action="close" @click="close">{{ pm('close') }}</Button></template
    >
  </ModalDialog>
  <ConfirmActionDialog
    v-model:open="confirmationOpen"
    :title="pm('confirmTitle')"
    :description="pm('schemaConfirmHint')"
    :confirm-label="pm('sendOnce')"
    :pending="busy"
    @confirm="send"
  >
    <p class="break-all font-mono">{{ productId }}</p>
    <p>{{ pm('schemaConfirmHint') }}</p>
  </ConfirmActionDialog>
</template>
