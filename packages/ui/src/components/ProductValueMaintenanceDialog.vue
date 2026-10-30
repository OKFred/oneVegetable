<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import {
  PRODUCT_MAINTENANCE_METHODS,
  canonicalizeProductMaintenanceDraft,
  validateProductPriceDraft,
  validateProductInventoryDraft,
  validateProductDraftDeleteDraft,
  type ProductMaintenanceDraft
} from '@one-vegetable/core/product-maintenance-api';
import {
  parseProductMaintenanceRecord,
  type ProductMaintenanceCommand,
  type ProductMaintenanceServiceResult,
  type ProductMaintenanceTask
} from '@one-vegetable/core/product-maintenance-service';
import {
  requireProductOperationContext,
  type ProductOperationContext
} from '@one-vegetable/core/product-operation-context';
import { describeUserVisibleError, GatewayException } from '@one-vegetable/core/errors';
import type { ProductMutationJob } from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { useProductValueMaintenanceI18n } from '../i18n/product-value-maintenance';
import ModalDialog from './ui/ModalDialog.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';

const props = withDefaults(defineProps<{ productId?: string; kind: 'price' | 'inventory' | 'drafts' }>(), {
  productId: ''
});
const emit = defineEmits<{ close: [] }>();
const pm = useProductValueMaintenanceI18n();
const services = useServices();
const identity = useListIdentityScope();
const operation = computed(() =>
  props.kind === 'price' ? 'setPrice' : props.kind === 'inventory' ? 'setInventory' : 'deleteDraft'
);
const method = computed(() => PRODUCT_MAINTENANCE_METHODS[operation.value]);
const priceMode = ref<'tiered' | 'range' | 'sku'>('tiered');
const inventoryMode = ref<'spu' | 'sku'>('spu');
const currency = ref('');
const tiers = ref([{ quantity: '', price: '' }]);
const prices = ref([{ skuId: '', price: '' }]);
const inventories = ref([{ skuId: '', inventory: '' }]);
const minPrice = ref(''),
  maxPrice = ref(''),
  inventory = ref('');
const task = ref<ProductMaintenanceTask | null>(null);
const maintenanceTasks = ref<ProductMaintenanceTask[]>([]);
const tasksLoaded = ref(false),
  resumed = ref(false);
const receipts = ref<ProductMutationJob[]>([]);
const receiptContext = ref<ProductOperationContext | null>(null);
const selectedDraftId = ref('');
const page = ref(1),
  total = ref(0),
  loaded = ref(false);
const busy = ref(false),
  confirmationOpen = ref(false);
const error = ref<unknown>(null);
const lastRequestId = ref('');
const notice = ref(false);
const sentIds = ref(new Set<string>());
let sequence = 0;
let preparedSignature = '';

const sameContext = (a: ProductOperationContext | null, b: ProductOperationContext) =>
  a?.identity === b.identity && a.gateway === b.gateway;
function fail(code: string): never {
  throw new Error(code);
}
const draft = computed<ProductMaintenanceDraft>(() => {
  if (props.kind === 'drafts')
    return {
      operation: 'deleteDraft',
      draftIds: [selectedDraftId.value],
      knownDrafts: [{ kind: 'draft', draftId: selectedDraftId.value, source: 'draft-create' }]
    };
  if (props.kind === 'inventory')
    return inventoryMode.value === 'spu'
      ? { operation: 'setInventory', productId: props.productId, mode: 'spu', inventory: inventory.value }
      : { operation: 'setInventory', productId: props.productId, mode: 'sku', skus: inventories.value };
  if (priceMode.value === 'range')
    return {
      operation: 'setPrice',
      productId: props.productId,
      mode: 'range',
      currency: 'USD',
      minPrice: minPrice.value,
      maxPrice: maxPrice.value
    };
  if (priceMode.value === 'sku')
    return {
      operation: 'setPrice',
      productId: props.productId,
      mode: 'sku',
      currency: currency.value,
      skus: prices.value
    };
  return {
    operation: 'setPrice',
    productId: props.productId,
    mode: 'tiered',
    currency: 'USD',
    tiers: tiers.value
  };
});
const valid = computed(() =>
  props.kind === 'price'
    ? validateProductPriceDraft(draft.value)
    : props.kind === 'inventory'
      ? validateProductInventoryDraft(draft.value)
      : receipts.value.some((job) => job.productId === selectedDraftId.value) &&
        validateProductDraftDeleteDraft(draft.value)
);
const signature = computed(() => JSON.stringify(draft.value));
const attempted = computed(() =>
  Boolean(task.value && (task.value.submitAttempted || sentIds.value.has(task.value.id)))
);
const canSend = computed(() =>
  Boolean(
    props.kind !== 'price' &&
    task.value &&
    !busy.value &&
    !attempted.value &&
    !resumed.value &&
    task.value.status === 'prepared' &&
    preparedSignature === signature.value &&
    (props.kind === 'drafts' || task.value.baseline)
  )
);
const canVerify = computed(() =>
  Boolean(
    task.value &&
    attempted.value &&
    !busy.value &&
    !['verified', 'cancelled', 'rejected'].includes(task.value.status)
  )
);
const details = computed(() => (error.value ? describeUserVisibleError(error.value) : null));
const errorCode = computed(() => {
  const value = details.value?.code ?? (error.value instanceof Error ? error.value.message : '');
  return value && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value) ? value : '';
});
const subCode = computed(() => {
  const value = error.value instanceof GatewayException ? error.value.gatewayError.subCode : null;
  return value && /^(?:isv|isp)\.[a-z0-9_.-]{1,120}$/u.test(value) ? value : '';
});
const permissionDenied = computed(() =>
  /permission|forbidden|restricted/iu.test(errorCode.value + ' ' + subCode.value)
);
const maintenanceHints = {
  METHOD_DISABLED: 'methodDisabledHint',
  BASELINE_CHANGED: 'baselineChangedHint',
  REVIEW_PENDING: 'reviewPendingHint',
  PRODUCT_STATE_UNCONFIRMED: 'reviewPendingHint',
  NON_TARGET_FIELDS_CHANGED: 'nonTargetChangedHint',
  INTEGRITY_UNAVAILABLE: 'integrityUnavailableHint',
  INTEGRITY_SNAPSHOT_UNAVAILABLE: 'integrityUnavailableHint',
  ENTITY_BUSY: 'entityBusyHint',
  ALREADY_ATTEMPTED: 'alreadyAttemptedHint',
  DRAFT_VERIFICATION_UNAVAILABLE: 'draftVerificationUnavailableHint'
} as const;
function maintenanceHint(code: string) {
  return (
    Object.entries(maintenanceHints).find(
      ([suffix]) => code === suffix || code.endsWith('_' + suffix)
    )?.[1] ?? 'failed'
  );
}
const errorHint = computed(() =>
  permissionDenied.value ? 'permissionDenied' : maintenanceHint(errorCode.value)
);
const taskHint = computed(() => {
  const hint = maintenanceHint(task.value?.reasonCode ?? '');
  if (hint !== 'failed') return hint;
  return props.kind === 'drafts' && task.value?.readback?.status === 'unavailable'
    ? 'draftVerificationUnavailableHint'
    : '';
});

const receiptDiagnostics = computed(() => {
  const receipt = task.value?.receipt;
  if (!receipt) return null;
  const stable = (value: unknown): string =>
    typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/u.test(value) ? value : '';
  const info = {
    errorCode: stable('errorCode' in receipt ? receipt.errorCode : null),
    subCode: stable('subCode' in receipt ? receipt.subCode : null),
    traceId: stable('traceId' in receipt ? receipt.traceId : null)
  };
  return info.errorCode || info.subCode || info.traceId ? info : null;
});
const receiptHint = computed(() => {
  const info = receiptDiagnostics.value;
  if (!info) return '';
  if (/permission|forbidden|restricted/iu.test(info.errorCode + ' ' + info.subCode))
    return 'permissionDenied';
  const hint = maintenanceHint(info.errorCode);
  if (hint !== 'failed') return hint;
  if (task.value?.receipt?.status === 'rejected') return 'receiptRejectedHint';
  return info.errorCode || info.subCode ? 'receiptIssueHint' : '';
});

function fieldLabel(path: string): string {
  if (path === 'auditStatus' || path === 'productStatus') return pm('reviewState');
  if (path === 'integrity/modelNumber') return pm('modelNumber');
  if (path.startsWith('integrity/')) return pm('nonTargetField');
  if (path === 'inventory') return pm('inventory');
  if (path === 'draft') return pm('draftId');
  const parts = path.split('/');
  const last = parts.at(-1);
  const label =
    last === 'type'
      ? pm('type')
      : last === 'currency'
        ? pm('currency')
        : last === 'min'
          ? pm('minPrice')
          : last === 'max'
            ? pm('maxPrice')
            : last === 'inventory'
              ? pm('inventory')
              : pm('price');
  if (parts[0] === 'skus') return pm('skuId') + ' ' + (parts[1] ?? '') + ' · ' + label;
  if (parts[1] === 'tiers') return pm('tier') + ' ' + (parts[2] ?? '') + ' · ' + pm('price');
  return label;
}
function targetFields(value: ProductMaintenanceDraft): Record<string, string> {
  if (value.operation === 'deleteDraft') return { draft: value.draftIds[0] ?? '' };
  if (value.mode === 'sku')
    return Object.fromEntries(
      value.skus.flatMap((row) =>
        value.operation === 'setPrice' && 'price' in row
          ? [
              ['skus/' + row.skuId + '/price', row.price],
              ['skus/' + row.skuId + '/currency', value.currency]
            ]
          : 'inventory' in row
            ? [['skus/' + row.skuId + '/inventory', row.inventory]]
            : []
      )
    );
  if (value.operation === 'setInventory') return { inventory: value.inventory };
  const common = {
    'price/type': value.mode === 'tiered' ? 'TIERED' : 'RANGE',
    'price/currency': value.currency
  };
  return value.mode === 'range'
    ? { ...common, 'price/min': value.minPrice, 'price/max': value.maxPrice }
    : {
        ...common,
        ...Object.fromEntries(value.tiers.map((tier) => ['price/tiers/' + tier.quantity, tier.price]))
      };
}
const previewRows = computed(() => {
  if (!task.value) return [];
  const target = targetFields(task.value.intent.draft),
    baseline = task.value.baseline?.fields ?? {};
  return [...new Set([...Object.keys(baseline), ...Object.keys(target)])]
    .filter((path) => !path.startsWith('integrity/'))
    .map((path) => ({
      path,
      label: fieldLabel(path),
      before: baseline[path] ?? '—',
      after: target[path] ?? '—'
    }));
});
function invalidate(): void {
  sequence++;
  task.value = null;
  maintenanceTasks.value = [];
  tasksLoaded.value = false;
  resumed.value = false;
  receipts.value = [];
  receiptContext.value = null;
  selectedDraftId.value = '';
  preparedSignature = '';
  confirmationOpen.value = false;
  busy.value = false;
  error.value = null;
  loaded.value = false;
  notice.value = false;
  lastRequestId.value = '';
  page.value = 1;
  total.value = 0;
  tiers.value = [{ quantity: '', price: '' }];
  prices.value = [{ skuId: '', price: '' }];
  inventories.value = [{ skuId: '', inventory: '' }];
  currency.value = '';
  inventory.value = '';
  minPrice.value = '';
  maxPrice.value = '';
}
watch(identity, invalidate, { flush: 'sync' });
watch(() => [props.kind, props.productId], invalidate, { flush: 'sync' });
watch(
  signature,
  () => {
    confirmationOpen.value = false;
    if (busy.value) {
      sequence++;
      busy.value = false;
    }
  },
  { flush: 'sync' }
);
globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, invalidate);
onScopeDispose(() => {
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, invalidate);
  sequence++;
});
async function context(): Promise<ProductOperationContext> {
  if (!services.gateway.galleryTransferContext) return fail('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
  const value = await services.gateway.galleryTransferContext('callCapability', {
    method: method.value,
    parameters: {}
  });
  return requireProductOperationContext({ identity: value.identity, gateway: value.gateway });
}
async function run(
  work: (scope: ProductOperationContext, current: () => void) => Promise<void>
): Promise<void> {
  if (busy.value || !services.productMaintenance) return;
  const captured = ++sequence;
  busy.value = true;
  error.value = null;
  notice.value = false;
  const current = () => {
    if (captured !== sequence) fail('PRODUCT_CONTEXT_CHANGED');
  };
  try {
    const scope = await context();
    current();
    if (task.value && !sameContext(task.value.context, scope)) {
      invalidate();
      fail('PRODUCT_CONTEXT_CHANGED');
    }
    await work(scope, current);
  } catch (cause: unknown) {
    if (captured === sequence) error.value = cause;
  } finally {
    if (captured === sequence) busy.value = false;
  }
}
async function command(
  value: ProductMaintenanceCommand,
  scope: ProductOperationContext,
  current: () => void
) {
  current();
  const control = services.productMaintenance;
  if (!control) return fail('PRODUCT_MAINTENANCE_UNAVAILABLE');
  lastRequestId.value = globalThis.crypto.randomUUID();
  const result = await control.productMaintenance(value, scope, lastRequestId.value);
  current();
  if (!sameContext(scope, await context())) {
    invalidate();
    return fail('PRODUCT_CONTEXT_CHANGED');
  }
  current();
  return result;
}
function checkedTask(
  result: ProductMaintenanceServiceResult,
  scope: ProductOperationContext,
  id?: string
): ProductMaintenanceTask {
  const raw = result.tasks.length === 1 ? result.tasks[0] : null;
  if (!raw) return fail('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  const value = parseProductMaintenanceRecord({ ownerId: 'ui-validation', task: raw }).task;
  if (
    !sameContext(value.context, scope) ||
    value.intent.operation !== operation.value ||
    value.intent.method !== method.value ||
    (id !== undefined && value.id !== id)
  )
    return fail('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  if (value.intent.draft.operation === 'deleteDraft') {
    if (value.intent.draft.draftIds.length !== 1 || value.intent.draft.draftIds[0] !== selectedDraftId.value)
      return fail('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  } else if (value.intent.draft.productId !== props.productId)
    return fail('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  return value;
}
function prepare(): void {
  if (!valid.value || task.value) return;
  const input = JSON.parse(canonicalizeProductMaintenanceDraft(draft.value)) as ProductMaintenanceDraft,
    original = signature.value;
  void run(async (scope, current) => {
    if (
      props.kind === 'drafts' &&
      (!sameContext(receiptContext.value, scope) ||
        !receipts.value.some((job) => job.productId === selectedDraftId.value))
    )
      return fail('PRODUCT_MAINTENANCE_KNOWN_DRAFT_REQUIRED');
    const result = await command({ action: 'create', draft: input }, scope, current);
    const value = checkedTask(result, scope);
    if (
      value.status !== 'prepared' ||
      value.submitAttempted ||
      (props.kind !== 'drafts' &&
        (!value.baseline ||
          canonicalizeProductMaintenanceDraft(value.intent.draft) !==
            canonicalizeProductMaintenanceDraft(input)))
    )
      return fail('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
    task.value = value;
    preparedSignature = original;
  });
}
function prepareDelete(job: ProductMutationJob): void {
  if (
    task.value ||
    busy.value ||
    !receipts.value.some((item) => item.id === job.id && item.productId === job.productId)
  )
    return;
  selectedDraftId.value = job.productId;
  prepare();
}
function send(): void {
  if (props.kind === 'price' || !canSend.value || !task.value) return;
  const value = task.value;
  confirmationOpen.value = false;
  void run(async (scope, current) => {
    sentIds.value = new Set([...sentIds.value, value.id]);
    const result = await command(
      { action: 'send', taskId: value.id, revision: value.revision, fingerprint: value.intent.fingerprint },
      scope,
      current
    );
    task.value = checkedTask(result, scope, value.id);
  });
}
function refresh(verify = false): void {
  const value = task.value;
  if (!value) return;
  void run(async (scope, current) => {
    let updated = checkedTask(
      await command({ action: 'get', taskId: value.id }, scope, current),
      scope,
      value.id
    );
    task.value = updated;
    if (
      verify &&
      updated.submitAttempted &&
      !['verified', 'rejected', 'cancelled'].includes(updated.status)
    ) {
      updated = checkedTask(
        await command({ action: 'verify', taskId: updated.id, revision: updated.revision }, scope, current),
        scope,
        value.id
      );
      task.value = updated;
    }
  });
}
function cancelPreview(): void {
  const value = task.value;
  if (!value || attempted.value || value.status !== 'prepared') return;
  void run(async (scope, current) => {
    const updated = checkedTask(
      await command({ action: 'cancel', taskId: value.id, revision: value.revision }, scope, current),
      scope,
      value.id
    );
    if (updated.status !== 'cancelled') return fail('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
    task.value = null;
    preparedSignature = '';
    notice.value = true;
    resumed.value = false;
    maintenanceTasks.value = maintenanceTasks.value.filter((item) => item.id !== value.id);
  });
}
function loadDrafts(nextPage = 1): void {
  if (!services.productMutationJobs || task.value) return;
  void run(async (scope, current) => {
    const jobs = await services.productMutationJobs?.list({
      page: nextPage,
      pageSize: 50,
      status: 'verified'
    });
    current();
    if (!jobs || !sameContext(scope, await context())) {
      invalidate();
      return;
    }
    current();
    receipts.value = jobs.items.filter(
      (job) =>
        job.protocol === 'iop' &&
        job.operation === 'saveProductDraft' &&
        job.status === 'verified' &&
        sameContext(job.productContext ?? null, scope) &&
        /^[1-9][0-9]*$/u.test(job.productId)
    );
    receiptContext.value = scope;
    page.value = nextPage;
    total.value = jobs.total;
    loaded.value = true;
  });
}
function loadTasks(): void {
  void run(async (scope, current) => {
    const result = await command({ action: 'list' }, scope, current);
    maintenanceTasks.value = result.tasks
      .map((item) => parseProductMaintenanceRecord({ ownerId: 'ui-validation', task: item }).task)
      .filter((item) => {
        if (
          !sameContext(item.context, scope) ||
          item.intent.operation !== operation.value ||
          item.intent.method !== method.value ||
          ['verified', 'rejected', 'cancelled'].includes(item.status)
        )
          return false;
        return item.intent.draft.operation === 'deleteDraft'
          ? item.intent.draft.draftIds.length === 1
          : item.intent.draft.productId === props.productId;
      })
      .sort((left, right) => right.createTimeUtc - left.createTimeUtc);
    tasksLoaded.value = true;
  });
}
function selectTask(id: string): void {
  if (busy.value) return;
  const item = maintenanceTasks.value.find((value) => value.id === id);
  if (!item) return;
  if (item.intent.draft.operation === 'deleteDraft')
    selectedDraftId.value = item.intent.draft.draftIds[0] ?? '';
  task.value = item;
  resumed.value = true;
  preparedSignature = '';
  confirmationOpen.value = false;
  error.value = null;
}
function backToTasks(): void {
  if (busy.value) return;
  task.value = null;
  resumed.value = false;
  preparedSignature = '';
  confirmationOpen.value = false;
}

function close(): void {
  if (!busy.value) {
    invalidate();
    emit('close');
  }
}
</script>

<template>
  <ModalDialog
    :open="true"
    :dismissible="!busy"
    :title="pm(kind === 'price' ? 'priceTitle' : kind === 'inventory' ? 'inventoryTitle' : 'draftsTitle')"
    :description="pm(kind === 'price' ? 'priceSafetyTitle' : 'iopHint')"
    size="lg"
    @update:open="close"
  >
    <div class="space-y-4 text-sm" :aria-busy="busy">
      <section
        v-if="kind === 'price'"
        role="note"
        data-price-safety
        :aria-label="pm('priceSafetyTitle')"
        class="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
      >
        <h3 class="font-medium">{{ pm('priceSafetyTitle') }}</h3>
        <p>{{ pm('priceSafetyHint') }}</p>
        <p>{{ pm('priceEditorHint') }}</p>
      </section>
      <p v-if="!services.productMaintenance" role="status" class="rounded-md border p-3">
        {{ pm('unavailable') }}
      </p>
      <section class="space-y-2 rounded-md border p-3">
        <h3 class="font-medium">{{ pm('maintenanceTasks') }}</h3>
        <Button
          variant="outline"
          data-action="load-tasks"
          :disabled="busy || Boolean(task) || !services.productMaintenance"
          @click="loadTasks"
          >{{ pm('loadTasks') }}</Button
        >
        <p v-if="tasksLoaded && !maintenanceTasks.length">{{ pm('emptyTasks') }}</p>
        <ul v-if="!task" class="space-y-2">
          <li
            v-for="item in maintenanceTasks"
            :key="item.id"
            class="flex flex-wrap items-center justify-between gap-2"
          >
            <span class="break-all"
              ><span class="font-mono">{{ item.id }}</span> · {{ pm(item.status) }}</span
            >
            <Button
              variant="outline"
              data-action="select-task"
              :disabled="busy"
              @click="selectTask(item.id)"
              >{{ pm('selectTask') }}</Button
            >
          </li>
        </ul>
      </section>
      <p class="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">{{ pm('closeHint') }}</p>
      <template v-if="kind !== 'drafts'">
        <p>
          <span class="text-muted-foreground">{{ pm('product') }}:</span>
          <span class="break-all font-mono">{{ productId || pm('productRequired') }}</span>
        </p>
        <p v-if="kind === 'inventory'" class="text-muted-foreground">{{ pm('inventoryHint') }}</p>
        <form class="space-y-3" @submit.prevent="prepare">
          <fieldset class="space-y-3 disabled:opacity-70" :disabled="busy || Boolean(task)">
            <template v-if="kind === 'price'">
              <label class="block space-y-1"
                ><span>{{ pm('priceMode') }}</span>
                <select
                  v-model="priceMode"
                  data-field="priceMode"
                  :aria-label="pm('priceMode')"
                  class="h-9 w-full rounded-md border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="tiered">{{ pm('tiered') }}</option>
                  <option value="range">{{ pm('range') }}</option>
                  <option value="sku">{{ pm('sku') }}</option>
                </select>
              </label>
              <p v-if="priceMode !== 'sku'">{{ pm('currency') }}: USD</p>
              <template v-if="priceMode === 'tiered'">
                <div
                  v-for="(tier, index) in tiers"
                  :key="index"
                  class="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                >
                  <label class="min-w-0 space-y-1"
                    ><span>{{ pm('quantity') }}</span
                    ><Input
                      v-model="tier.quantity"
                      :data-field="'tier-quantity-' + index"
                      :aria-label="pm('quantity') + ' ' + (index + 1)"
                      inputmode="numeric"
                  /></label>
                  <label class="min-w-0 space-y-1"
                    ><span>{{ pm('price') }}</span
                    ><Input
                      v-model="tier.price"
                      :data-field="'tier-price-' + index"
                      :aria-label="pm('price') + ' ' + (index + 1)"
                      inputmode="decimal"
                  /></label>
                  <Button
                    variant="outline"
                    :disabled="tiers.length === 1"
                    :aria-label="pm('remove') + ' ' + (index + 1)"
                    @click="tiers.splice(index, 1)"
                    >{{ pm('remove') }}</Button
                  >
                </div>
                <Button
                  variant="outline"
                  data-action="add-tier"
                  :disabled="tiers.length >= 50"
                  @click="tiers.push({ quantity: '', price: '' })"
                  >{{ pm('addTier') }}</Button
                >
              </template>
              <div v-else-if="priceMode === 'range'" class="grid gap-3 sm:grid-cols-2">
                <label class="space-y-1"
                  ><span>{{ pm('minPrice') }}</span
                  ><Input
                    v-model="minPrice"
                    data-field="minPrice"
                    :aria-label="pm('minPrice')"
                    inputmode="decimal"
                /></label>
                <label class="space-y-1"
                  ><span>{{ pm('maxPrice') }}</span
                  ><Input
                    v-model="maxPrice"
                    data-field="maxPrice"
                    :aria-label="pm('maxPrice')"
                    inputmode="decimal"
                /></label>
              </div>
              <template v-else>
                <label class="block space-y-1"
                  ><span>{{ pm('currency') }}</span
                  ><Input v-model="currency" data-field="currency" :aria-label="pm('currency')" maxlength="3"
                /></label>
                <p class="text-xs text-muted-foreground">{{ pm('skuCurrencyHint') }}</p>
                <div
                  v-for="(row, index) in prices"
                  :key="index"
                  class="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                >
                  <label class="min-w-0 space-y-1"
                    ><span>{{ pm('skuId') }}</span
                    ><Input
                      v-model="row.skuId"
                      :data-field="'price-sku-' + index"
                      :aria-label="pm('skuId') + ' ' + (index + 1)"
                      inputmode="numeric"
                  /></label>
                  <label class="min-w-0 space-y-1"
                    ><span>{{ pm('price') }}</span
                    ><Input
                      v-model="row.price"
                      :data-field="'sku-price-' + index"
                      :aria-label="pm('price') + ' ' + (index + 1)"
                      inputmode="decimal"
                  /></label>
                  <Button
                    variant="outline"
                    :disabled="prices.length === 1"
                    :aria-label="pm('remove') + ' ' + (index + 1)"
                    @click="prices.splice(index, 1)"
                    >{{ pm('remove') }}</Button
                  >
                </div>
                <Button
                  variant="outline"
                  data-action="add-price-sku"
                  :disabled="prices.length >= 50"
                  @click="prices.push({ skuId: '', price: '' })"
                  >{{ pm('addSku') }}</Button
                >
              </template>
            </template>
            <template v-else>
              <label class="block space-y-1"
                ><span>{{ pm('inventoryTitle') }}</span>
                <select
                  v-model="inventoryMode"
                  data-field="inventoryMode"
                  :aria-label="pm('inventoryTitle')"
                  class="h-9 w-full rounded-md border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="spu">{{ pm('spu') }}</option>
                  <option value="sku">{{ pm('sku') }}</option>
                </select>
              </label>
              <label v-if="inventoryMode === 'spu'" class="block space-y-1"
                ><span>{{ pm('inventory') }}</span
                ><Input
                  v-model="inventory"
                  data-field="inventory"
                  :aria-label="pm('inventory')"
                  inputmode="numeric"
              /></label>
              <template v-else>
                <div
                  v-for="(row, index) in inventories"
                  :key="index"
                  class="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                >
                  <label class="min-w-0 space-y-1"
                    ><span>{{ pm('skuId') }}</span
                    ><Input
                      v-model="row.skuId"
                      :data-field="'inventory-sku-' + index"
                      :aria-label="pm('skuId') + ' ' + (index + 1)"
                      inputmode="numeric"
                  /></label>
                  <label class="min-w-0 space-y-1"
                    ><span>{{ pm('inventory') }}</span
                    ><Input
                      v-model="row.inventory"
                      :data-field="'sku-inventory-' + index"
                      :aria-label="pm('inventory') + ' ' + (index + 1)"
                      inputmode="numeric"
                  /></label>
                  <Button
                    variant="outline"
                    :disabled="inventories.length === 1"
                    :aria-label="pm('remove') + ' ' + (index + 1)"
                    @click="inventories.splice(index, 1)"
                    >{{ pm('remove') }}</Button
                  >
                </div>
                <Button
                  variant="outline"
                  data-action="add-inventory-sku"
                  :disabled="inventories.length >= 50"
                  @click="inventories.push({ skuId: '', inventory: '' })"
                  >{{ pm('addSku') }}</Button
                >
              </template>
            </template>
          </fieldset>
          <p v-if="!valid && !task" class="text-xs text-muted-foreground">{{ pm('invalid') }}</p>
          <Button
            type="submit"
            data-action="prepare"
            :disabled="!services.productMaintenance || !valid || busy || Boolean(task)"
            >{{ pm('prepare') }}</Button
          >
        </form>
      </template>
      <template v-else>
        <p>{{ pm('draftsHint') }}</p>
        <Button
          variant="outline"
          data-action="load-drafts"
          :disabled="busy || Boolean(task) || !services.productMutationJobs || !services.productMaintenance"
          @click="loadDrafts()"
          >{{ pm('loadDrafts') }}</Button
        >
        <p v-if="loaded && !receipts.length">{{ pm('emptyDrafts') }}</p>
        <ul v-if="receipts.length" class="space-y-2">
          <li
            v-for="job in receipts"
            :key="job.id"
            class="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
          >
            <span class="break-all"
              >{{ pm('draftId') }}: <span class="font-mono">{{ job.productId }}</span
              ><span class="block text-xs text-muted-foreground"
                >{{ pm('receipt') }}: {{ job.requestId }}</span
              ></span
            >
            <Button
              variant="outline"
              data-action="prepare-delete"
              :disabled="busy || Boolean(task)"
              @click="prepareDelete(job)"
              >{{ pm('prepareDelete') }}</Button
            >
          </li>
        </ul>
        <div v-if="loaded" class="flex flex-wrap items-center gap-2">
          <span>{{ pm('page') }} {{ page }}</span>
          <Button
            variant="outline"
            :disabled="busy || Boolean(task) || page <= 1"
            @click="loadDrafts(page - 1)"
            >{{ pm('previous') }}</Button
          >
          <Button
            variant="outline"
            :disabled="busy || Boolean(task) || page * 50 >= total"
            @click="loadDrafts(page + 1)"
            >{{ pm('next') }}</Button
          >
        </div>
      </template>
      <section v-if="task" data-result="preview" class="space-y-3 rounded-md border p-3" aria-live="polite">
        <h3 class="font-medium">{{ pm('preview') }}</h3>
        <p v-if="resumed" role="status">{{ pm('resumedHint') }}</p>
        <p>
          {{ pm('status') }}: <span data-status>{{ pm(task.status) }}</span>
        </p>
        <p v-if="kind === 'drafts'">{{ pm('deleteHint') }}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b">
                <th scope="col" class="p-2">{{ pm('field') }}</th>
                <th scope="col" class="p-2">{{ pm('before') }}</th>
                <th scope="col" class="p-2">{{ pm('after') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in previewRows" :key="row.path" class="border-b last:border-0">
                <th scope="row" class="p-2 font-normal">{{ row.label }}</th>
                <td class="break-all p-2">{{ row.before }}</td>
                <td class="break-all p-2">{{ row.after }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="break-all text-xs text-muted-foreground">{{ pm('taskId') }}: {{ task.id }}</p>
        <p class="break-all text-xs text-muted-foreground">{{ pm('requestId') }}: {{ task.requestId }}</p>
        <p class="break-all text-xs text-muted-foreground">
          {{ pm('fingerprint') }}: {{ task.intent.fingerprint }}
        </p>
        <p v-if="attempted" role="status" class="text-amber-700 dark:text-amber-300">
          {{ pm('attemptedHint') }}
        </p>
        <p v-else-if="!resumed && preparedSignature !== signature" class="text-amber-700 dark:text-amber-300">
          {{ pm('editedHint') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" data-action="back-tasks" :disabled="busy" @click="backToTasks">{{
            pm('backToTasks')
          }}</Button>
          <Button data-action="review" :disabled="!canSend" @click="canSend && (confirmationOpen = true)">{{
            pm('confirm')
          }}</Button>
          <Button variant="outline" data-action="verify" :disabled="!canVerify" @click="refresh(true)">{{
            pm('verify')
          }}</Button>
          <Button variant="outline" data-action="refresh" :disabled="busy" @click="refresh()">{{
            pm('refresh')
          }}</Button>
          <Button
            v-if="task.status === 'prepared' && !attempted"
            variant="outline"
            data-action="cancel-preview"
            :disabled="busy"
            @click="cancelPreview"
            >{{ pm('cancelPreview') }}</Button
          >
        </div>
        <p v-if="taskHint" role="status" data-maintenance-hint>{{ pm(taskHint) }}</p>
        <details v-if="task.reasonCode" class="rounded-md border p-2 text-xs">
          <summary class="cursor-pointer">{{ pm('technicalDetails') }}</summary>
          <code class="block break-all pt-2">{{ task.reasonCode }}</code>
        </details>
        <p v-if="receiptHint" data-receipt-hint>{{ pm(receiptHint) }}</p>
        <details v-if="receiptDiagnostics" data-receipt-diagnostics class="rounded-md border p-2 text-xs">
          <summary class="cursor-pointer">{{ pm('technicalDetails') }}</summary>
          <code v-if="receiptDiagnostics.errorCode" class="block break-all pt-2">{{
            receiptDiagnostics.errorCode
          }}</code>
          <code v-if="receiptDiagnostics.subCode" class="block break-all pt-2">{{
            receiptDiagnostics.subCode
          }}</code>
          <p v-if="receiptDiagnostics.traceId" class="break-all pt-2">
            {{ pm('traceId') }}: {{ receiptDiagnostics.traceId }}
          </p>
        </details>
        <section v-if="task.readback" data-result="readback" class="space-y-1 border-t pt-2">
          <h4 class="font-medium">
            {{
              pm(
                task.readback.status === 'matched'
                  ? 'matched'
                  : task.readback.status === 'mismatched'
                    ? 'mismatched'
                    : 'unavailableReadback'
              )
            }}
          </h4>
          <p v-if="task.readback.mismatchedFields.length">
            {{ pm('mismatchedFields') }}: {{ task.readback.mismatchedFields.map(fieldLabel).join(', ') }}
          </p>
          <p v-if="task.readback.unavailableFields.length">
            {{ pm('unavailableFields') }}: {{ task.readback.unavailableFields.map(fieldLabel).join(', ') }}
          </p>
        </section>
      </section>
      <p v-if="notice" role="status">{{ pm('previewCancelled') }}</p>
      <p v-if="busy" role="status">{{ pm('busy') }}</p>
      <div
        v-if="error"
        role="alert"
        class="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
      >
        <p data-maintenance-hint>{{ pm(errorHint) }}</p>
        <details data-error-details class="rounded-md border p-2 text-xs">
          <summary class="cursor-pointer">{{ pm('technicalDetails') }}</summary>
          <code v-if="errorCode" class="block break-all pt-2">{{ errorCode }}</code>
          <code v-if="subCode" class="block break-all pt-2">{{ subCode }}</code>
          <p v-if="lastRequestId" class="break-all pt-2">{{ pm('requestId') }}: {{ lastRequestId }}</p>
          <p v-if="details?.traceId" class="break-all pt-2">{{ details.traceId }}</p>
        </details>
      </div>
    </div>
    <template #footer
      ><Button variant="outline" data-action="close" :disabled="busy" @click="close">{{
        pm('close')
      }}</Button></template
    >
  </ModalDialog>
  <ConfirmActionDialog
    v-model:open="confirmationOpen"
    :title="pm('confirmTitle')"
    :description="pm('confirmHint')"
    :confirm-label="pm('sendOnce')"
    :destructive="kind === 'drafts'"
    :pending="busy"
    @confirm="send"
  >
    <p>{{ pm('confirmHint') }}</p>
    <p v-if="task" class="break-all font-mono">
      {{
        kind === 'drafts' && task.intent.draft.operation === 'deleteDraft'
          ? task.intent.draft.draftIds[0]
          : productId
      }}
    </p>
  </ConfirmActionDialog>
</template>
