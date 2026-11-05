<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { OrderFulfillmentReadClient } from '../../../core/src/order-fulfillment-read';
import { FULFILLMENT_READ_METHODS } from '../../../core/src/order-fulfillment-methods';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { useOrderFulfillmentI18n } from '../i18n/order-fulfillment';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = withDefaults(defineProps<{ open?: boolean; productId?: string; orderId?: string }>(), {
  open: true,
  productId: '',
  orderId: ''
});
const emit = defineEmits<{ close: [] }>();
const text = useOrderFulfillmentI18n();
const { gateway } = useServices();
const identity = useListIdentityScope();
const client = new OrderFulfillmentReadClient(gateway, () => identity.value);
type Tab = 'warehouses' | 'freight' | 'tracking';
type ReadResult = Awaited<ReturnType<OrderFulfillmentReadClient['query']>>;
const tabs: Tab[] = ['warehouses', 'freight', 'tracking'];
const tab = ref<Tab>('warehouses');
const warehouseKind = ref<'normal' | 'ggs'>('normal');
const warehouseProductId = ref(props.productId);
const countryCode = ref('');
const pages = reactive({ normal: '1', ggs: '1' });
const freightKind = ref<'basic' | 'advanced'>('basic');
const freightProductId = ref(props.productId);
const quantity = ref('1');
const destinationCountry = ref('');
const zipCode = ref('');
const dispatchLocation = ref('');
const parametersJson = ref('{}');
const tradeId = ref(safeId(props.orderId) ? props.orderId : '');
const dismissed = ref(false);
const active = computed(() => props.open && !dismissed.value);
const result = ref<ReadResult | null>(null);
const busy = ref(false);
const error = ref<unknown>(null);
let sequence = 0;

function safeId(value: string): boolean {
  return /^[1-9][0-9]*$/u.test(value) && Number.isSafeInteger(Number(value));
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const advancedParameters = computed(() => {
  try {
    const parsed: unknown = JSON.parse(parametersJson.value);
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
});
const valid = computed(() => {
  if (tab.value === 'tracking') return safeId(tradeId.value);
  if (tab.value === 'warehouses')
    return (
      safeId(warehouseProductId.value) &&
      safeId(pages[warehouseKind.value]) &&
      (warehouseKind.value === 'ggs' ||
        !countryCode.value.trim() ||
        /^[a-z]{2}$/iu.test(countryCode.value.trim()))
    );
  if (freightKind.value === 'advanced') {
    const parameters = advancedParameters.value;
    return (
      !!parameters &&
      typeof parameters.e_company_id === 'string' &&
      !!parameters.e_company_id.trim() &&
      typeof parameters.destination_country === 'string' &&
      /^[a-z]{2}$/iu.test(parameters.destination_country.trim()) &&
      Array.isArray(parameters.logistics_product_list) &&
      parameters.logistics_product_list.length > 0
    );
  }
  return (
    safeId(freightProductId.value) &&
    safeId(quantity.value) &&
    /^[a-z]{2}$/iu.test(destinationCountry.value.trim())
  );
});
const inputSignature = computed(() =>
  JSON.stringify([
    tab.value,
    warehouseKind.value,
    warehouseProductId.value,
    countryCode.value,
    pages,
    freightKind.value,
    freightProductId.value,
    quantity.value,
    destinationCountry.value,
    zipCode.value,
    dispatchLocation.value,
    parametersJson.value,
    tradeId.value
  ])
);
function clearResults(): void {
  sequence++;
  client.invalidate();
  result.value = null;
  error.value = null;
  busy.value = false;
}
function resetInputs(prefill = false): void {
  clearResults();
  warehouseProductId.value = prefill ? props.productId : '';
  freightProductId.value = prefill ? props.productId : '';
  tradeId.value = prefill && safeId(props.orderId) ? props.orderId : '';
  countryCode.value = '';
  pages.normal = '1';
  pages.ggs = '1';
  quantity.value = '1';
  destinationCountry.value = '';
  zipCode.value = '';
  dispatchLocation.value = '';
  parametersJson.value = '{}';
}
watch(inputSignature, clearResults, { flush: 'sync' });
watch(
  identity,
  () => {
    resetInputs();
  },
  { flush: 'sync' }
);
watch(
  () => props.open,
  (open) => {
    dismissed.value = !open;
    resetInputs(open);
  },
  { flush: 'sync' }
);
watch(
  () => [props.productId, props.orderId],
  () => {
    resetInputs(true);
  },
  { flush: 'sync' }
);
const configurationChanged = () => {
  resetInputs();
};
globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, configurationChanged);
onScopeDispose(() => {
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, configurationChanged);
  clearResults();
  client.dispose();
});

async function query(): Promise<void> {
  if (!active.value || busy.value || !valid.value) return;
  let method: Parameters<OrderFulfillmentReadClient['query']>[0];
  let parameters: Record<string, unknown>;
  if (tab.value === 'warehouses') {
    method =
      warehouseKind.value === 'ggs'
        ? FULFILLMENT_READ_METHODS.ggsWarehouses
        : FULFILLMENT_READ_METHODS.warehouses;
    parameters = { product_id: warehouseProductId.value, current_page: Number(pages[warehouseKind.value]) };
    if (warehouseKind.value === 'ggs') parameters.page_size = 10;
    else if (countryCode.value.trim()) parameters.country_code = countryCode.value.trim().toUpperCase();
  } else if (tab.value === 'tracking') {
    method = FULFILLMENT_READ_METHODS.tracking;
    parameters = { trade_id: tradeId.value };
  } else if (freightKind.value === 'advanced') {
    method = FULFILLMENT_READ_METHODS.advancedFreight;
    const advanced = advancedParameters.value;
    if (!advanced) return;
    parameters = advanced;
  } else {
    method = FULFILLMENT_READ_METHODS.basicFreight;
    parameters = {
      product_id: freightProductId.value,
      quantity: Number(quantity.value),
      destination_country: destinationCountry.value.trim().toUpperCase()
    };
    if (zipCode.value.trim()) parameters.zip_code = zipCode.value.trim();
    if (dispatchLocation.value.trim()) parameters.dispatch_location = dispatchLocation.value.trim();
  }
  clearResults();
  const captured = ++sequence;
  busy.value = true;
  try {
    const response = await client.query(method, parameters);
    if (captured === sequence) result.value = response;
  } catch (cause: unknown) {
    if (captured === sequence) {
      error.value = cause;
      toast.error(text('failed'));
    }
  } finally {
    if (captured === sequence) busy.value = false;
  }
}
function fillCurrentProduct(): void {
  const parameters = advancedParameters.value;
  if (!parameters || !safeId(props.productId)) return;
  const list: unknown[] = Array.isArray(parameters.logistics_product_list)
    ? parameters.logistics_product_list
    : [];
  const first = record(list[0]) ? list[0] : {};
  parametersJson.value = JSON.stringify(
    {
      ...parameters,
      logistics_product_list: [
        {
          ...first,
          product_id: props.productId,
          ...(!('quantity' in first) && safeId(quantity.value) ? { quantity: Number(quantity.value) } : {})
        },
        ...list.slice(1)
      ]
    },
    null,
    2
  );
}
function changePage(delta: number): void {
  const page = pages[warehouseKind.value];
  const next = Number(page) + delta;
  if (safeId(page) && Number.isSafeInteger(next) && next > 0) pages[warehouseKind.value] = String(next);
}
function close(): void {
  dismissed.value = true;
  resetInputs();
  emit('close');
}
function updateOpen(open: boolean): void {
  if (!open) close();
}

const readableGroups = computed(() => {
  const groups: { path: string; fields: [string, unknown][]; nested: [string, unknown][] }[] = [];
  function visit(value: unknown, path: string): void {
    if (!record(value) && !Array.isArray(value)) return;
    const entries = Object.entries(value);
    const fields = entries.filter(([, field]) => typeof field !== 'object' || field === null);
    const nested = entries.filter(([, field]) => typeof field === 'object' && field !== null);
    if (fields.length) groups.push({ path, fields, nested });
    for (const [key, field] of nested) visit(field, path ? path + ' · ' + key : key);
  }
  if (result.value) visit(result.value.data, '');
  return groups;
});
function primitive(value: unknown): string {
  if (value === null) return text('unknown');
  if (typeof value === 'boolean') return text(value ? 'yes' : 'no');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : text('unknown');
}
</script>

<template>
  <ModalDialog
    :open="active"
    :title="text('title')"
    :description="text('readOnly')"
    size="lg"
    @update:open="updateOpen"
  >
    <div class="space-y-4 text-sm" :aria-busy="busy">
      <p class="rounded-md border bg-muted/40 p-3 text-muted-foreground">{{ text('iopHint') }}</p>
      <div class="flex flex-wrap gap-2" role="group" :aria-label="text('tabs')">
        <Button
          v-for="item in tabs"
          :key="item"
          :variant="tab === item ? 'default' : 'outline'"
          :data-tab="item"
          :aria-pressed="tab === item"
          @click="tab = item"
          >{{ text(item) }}</Button
        >
      </div>
      <form class="space-y-3" data-feedback-redact @submit.prevent="query">
        <template v-if="tab === 'warehouses'">
          <label class="block space-y-1"
            ><span>{{ text('warehouseKind') }}</span>
            <select
              v-model="warehouseKind"
              data-field="warehouseKind"
              :aria-label="text('warehouseKind')"
              class="h-9 w-full rounded-md border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="normal">{{ text('normal') }}</option>
              <option value="ggs">{{ text('ggs') }}</option>
            </select>
          </label>
          <label class="block space-y-1"
            ><span>{{ text('productId') }}</span>
            <Input
              v-model="warehouseProductId"
              data-field="warehouseProductId"
              :aria-label="text('productId')"
              inputmode="numeric"
              autocomplete="off"
              required
            />
          </label>
          <label v-if="warehouseKind === 'normal'" class="block space-y-1"
            ><span>{{ text('countryCode') }}</span>
            <Input
              v-model="countryCode"
              data-field="countryCode"
              :aria-label="text('countryCode')"
              autocomplete="off"
            />
          </label>
          <label class="block space-y-1"
            ><span>{{ text('page') }}</span>
            <Input
              v-model="pages[warehouseKind]"
              data-field="currentPage"
              :aria-label="text('page')"
              inputmode="numeric"
              required
            />
          </label>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              data-action="previous"
              :disabled="!safeId(pages[warehouseKind]) || Number(pages[warehouseKind]) <= 1"
              @click="changePage(-1)"
              >{{ text('previous') }}</Button
            >
            <Button
              variant="outline"
              data-action="next"
              :disabled="
                !safeId(pages[warehouseKind]) || Number(pages[warehouseKind]) >= Number.MAX_SAFE_INTEGER
              "
              @click="changePage(1)"
              >{{ text('next') }}</Button
            >
          </div>
          <p class="text-xs text-muted-foreground">{{ text('paginationHint') }}</p>
        </template>
        <template v-else-if="tab === 'freight'">
          <p class="text-muted-foreground">{{ text('freightHint') }}</p>
          <label class="block space-y-1"
            ><span>{{ text('freightKind') }}</span>
            <select
              v-model="freightKind"
              data-field="freightKind"
              :aria-label="text('freightKind')"
              class="h-9 w-full rounded-md border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="basic">{{ text('basic') }}</option>
              <option value="advanced">{{ text('advanced') }}</option>
            </select>
          </label>
          <template v-if="freightKind === 'basic'">
            <label class="block space-y-1"
              ><span>{{ text('productId') }}</span>
              <Input
                v-model="freightProductId"
                data-field="freightProductId"
                :aria-label="text('productId')"
                inputmode="numeric"
                autocomplete="off"
                required
              />
            </label>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block space-y-1"
                ><span>{{ text('quantity') }}</span>
                <Input
                  v-model="quantity"
                  data-field="quantity"
                  :aria-label="text('quantity')"
                  inputmode="numeric"
                  required
                />
              </label>
              <label class="block space-y-1"
                ><span>{{ text('destinationCountry') }}</span>
                <Input
                  v-model="destinationCountry"
                  data-field="destinationCountry"
                  :aria-label="text('destinationCountry')"
                  autocomplete="off"
                  data-feedback-redact
                  required
                />
              </label>
              <label class="block space-y-1"
                ><span>{{ text('zipCode') }}</span>
                <Input
                  v-model="zipCode"
                  data-field="zipCode"
                  :aria-label="text('zipCode')"
                  autocomplete="off"
                  data-feedback-redact
                />
              </label>
              <label class="block space-y-1"
                ><span>{{ text('dispatchLocation') }}</span>
                <Input
                  v-model="dispatchLocation"
                  data-field="dispatchLocation"
                  :aria-label="text('dispatchLocation')"
                  autocomplete="off"
                  data-feedback-redact
                />
              </label>
            </div>
          </template>
          <template v-else>
            <p class="text-xs text-muted-foreground">{{ text('advancedHint') }}</p>
            <label class="block space-y-1"
              ><span>{{ text('parameters') }}</span>
              <textarea
                v-model="parametersJson"
                data-field="parameters"
                :aria-label="text('parameters')"
                class="min-h-48 w-full rounded-md border bg-background p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                spellcheck="false"
                autocomplete="off"
                data-feedback-redact
                required
              />
            </label>
            <Button
              variant="outline"
              data-action="fillProduct"
              :disabled="!safeId(productId) || !advancedParameters"
              @click="fillCurrentProduct"
              >{{ text('fillProduct') }}</Button
            >
          </template>
        </template>
        <template v-else>
          <p class="text-muted-foreground">{{ text('trackingHint') }}</p>
          <label class="block space-y-1"
            ><span>{{ text('tradeId') }}</span>
            <Input
              v-model="tradeId"
              data-field="tradeId"
              :aria-label="text('tradeId')"
              inputmode="numeric"
              autocomplete="off"
              required
            />
          </label>
        </template>
        <p v-if="!valid" class="text-xs text-muted-foreground">
          {{ text(tab === 'freight' && freightKind === 'advanced' ? 'advancedInvalid' : 'invalid') }}
        </p>
        <Button type="submit" data-action="query" :disabled="busy || !valid">{{ text('query') }}</Button>
      </form>
      <p v-if="busy" role="status">{{ text('busy') }}</p>
      <div v-if="error" data-feedback-redact>
        <ErrorNotice :error="error" :fallback="text('failed')" compact />
      </div>
      <section
        v-if="result"
        data-result="fulfillment"
        class="space-y-3"
        aria-live="polite"
        data-feedback-redact
      >
        <h3 class="font-medium">
          {{
            text(
              tab === 'warehouses'
                ? 'warehouseResults'
                : tab === 'freight'
                  ? 'freightResults'
                  : 'trackingResults'
            )
          }}
        </h3>
        <p class="break-all text-xs text-muted-foreground">{{ text('trace') }}: {{ result.traceId }}</p>
        <p v-if="!readableGroups.length">{{ text('empty') }}</p>
        <article
          v-for="(group, index) in readableGroups"
          :key="index"
          class="space-y-2 rounded-md border p-3"
          data-readable-group
        >
          <h4 v-if="group.path" class="break-all font-medium">{{ group.path }}</h4>
          <dl class="space-y-1">
            <div
              v-for="[key, value] in group.fields"
              :key="key"
              class="grid gap-1 sm:grid-cols-[minmax(8rem,1fr)_2fr]"
            >
              <dt class="break-words text-muted-foreground">{{ key }}</dt>
              <dd class="whitespace-pre-wrap break-words">{{ primitive(value) }}</dd>
            </div>
          </dl>
          <details v-for="[key, value] in group.nested" :key="key">
            <summary class="cursor-pointer break-all">{{ text('nested') }} · {{ key }}</summary>
            <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs" tabindex="0">{{
              JSON.stringify(value, null, 2)
            }}</pre>
          </details>
        </article>
        <details data-result="raw">
          <summary class="cursor-pointer">{{ text('raw') }}</summary>
          <pre class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs" tabindex="0">{{
            JSON.stringify(result.data, null, 2)
          }}</pre>
        </details>
      </section>
    </div>
    <template #footer
      ><Button variant="outline" data-action="close" @click="close">{{ text('close') }}</Button></template
    >
  </ModalDialog>
</template>
