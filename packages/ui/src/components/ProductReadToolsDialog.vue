<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
// Kept independently testable until the parent registers the public package export.
import {
  ProductReadToolsClient,
  createShippingCoverageRequest,
  createTranslationReadRequest,
  type ProductReadResult,
  type ShippingCountry,
  type ShippingCoverageCountry,
  type ShippingCoverageInput,
  type TranslationReadResult
} from '../../../core/src/product-read-tools';
import { describeUserVisibleError, GatewayException } from '@one-vegetable/core/errors';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { useProductReadToolsI18n } from '../i18n/product-read-tools';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = withDefaults(
  defineProps<{
    kind: 'translation' | 'shipping';
    open?: boolean;
    productTitle?: string;
    productId?: string;
  }>(),
  { open: true, productTitle: '', productId: '' }
);
const emit = defineEmits<{ close: [] }>();
const pr = useProductReadToolsI18n();
const { gateway } = useServices();
const identity = useListIdentityScope();
const client = new ProductReadToolsClient(gateway, () => identity.value);
const sourceText = ref(props.productTitle);
const appName = ref('');
const sourceLanguage = ref('');
const targetLanguage = ref('');
const fieldType = ref<'title' | 'offer'>('title');
const translation = ref<TranslationReadResult | null>(null);
const copied = ref(false);
const copyFailed = ref(false);
const templates = ref<{ id: string; name: string }[]>([]);
const countries = ref<ProductReadResult<ShippingCountry> | null>(null);
const coverage = ref<ProductReadResult<ShippingCoverageCountry> | null>(null);
const shippingTemplateId = ref('');
const weight = ref('');
const length = ref('');
const width = ref('');
const height = ref('');
const moq = ref('');
const saleType = ref<'normal' | 'batch'>('normal');
const batchNum = ref('');
const productType = ref('');
const resultLanguage = ref('');
const busy = ref(false);
const error = ref<unknown>(null);
let sequence = 0;

const translationInput = computed(() => ({
  text: sourceText.value,
  appName: appName.value,
  sourceLanguage: sourceLanguage.value,
  targetLanguage: targetLanguage.value,
  fieldType: fieldType.value
}));
const shippingInput = computed<ShippingCoverageInput>(() => ({
  shippingTemplateId: shippingTemplateId.value,
  weightKg: weight.value,
  lengthCm: length.value,
  widthCm: width.value,
  heightCm: height.value,
  moq: Number(moq.value),
  saleType: saleType.value,
  batchNum: Number(batchNum.value),
  productType: Number(productType.value) as 1 | 2,
  language: resultLanguage.value
}));
function valid(action: () => unknown): boolean {
  try {
    action();
    return true;
  } catch {
    return false;
  }
}
const translationValid = computed(() => valid(() => createTranslationReadRequest(translationInput.value)));
const shippingValid = computed(() => valid(() => createShippingCoverageRequest(shippingInput.value)));
const failure = computed(() => (error.value ? describeUserVisibleError(error.value) : null));
const failureCode = computed(() => {
  const code = failure.value?.code;
  return code && /^[A-Za-z0-9_.;:-]{1,160}$/u.test(code) ? code : '';
});
const signature = computed(() => JSON.stringify([translationInput.value, shippingInput.value]));
const failureSubCode = computed(() => {
  const code = error.value instanceof GatewayException ? error.value.gatewayError.subCode : null;
  return typeof code === 'string' && /^(?:isv|isp)\.[a-z0-9_.-]{1,120}$/u.test(code) ? code : '';
});
const permissionDenied = computed(() =>
  /permission|forbidden|restricted/iu.test(failureCode.value + ' ' + failureSubCode.value)
);
function clearResults(): void {
  sequence++;
  client.invalidate();
  translation.value = null;
  coverage.value = null;
  error.value = null;
  copied.value = false;
  copyFailed.value = false;
  busy.value = false;
}
function reset(): void {
  clearResults();
  templates.value = [];
  countries.value = null;
  shippingTemplateId.value = '';
  appName.value = '';
  sourceText.value = props.productTitle;
}
watch(signature, clearResults, { flush: 'sync' });
watch(
  resultLanguage,
  () => {
    countries.value = null;
  },
  { flush: 'sync' }
);
watch(identity, reset, { flush: 'sync' });
watch(() => [props.kind, props.open, props.productId, props.productTitle], reset, { flush: 'sync' });
globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, reset);
onScopeDispose(() => {
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, reset);
  clearResults();
  client.dispose();
});

async function run<T>(action: () => Promise<T>, apply: (result: T) => void): Promise<void> {
  if (busy.value) return;
  clearResults();
  const captured = ++sequence;
  busy.value = true;
  try {
    const result = await action();
    if (captured === sequence) apply(result);
  } catch (cause: unknown) {
    if (captured === sequence) error.value = cause;
  } finally {
    if (captured === sequence) busy.value = false;
  }
}
function translate(): void {
  if (!translationValid.value) return;
  void run(
    () => client.translateText(translationInput.value),
    (result) => {
      translation.value = result;
    }
  );
}
function loadTemplates(): void {
  templates.value = [];
  void run(
    () => client.listShippingTemplates(),
    (result) => {
      templates.value = result;
    }
  );
}
function loadCountries(): void {
  countries.value = null;
  void run(
    () => client.listCountries(resultLanguage.value),
    (result) => {
      countries.value = result;
    }
  );
}
function queryCoverage(): void {
  if (!shippingValid.value) return;
  void run(
    () => client.getShippingCoverage(shippingInput.value),
    (result) => {
      coverage.value = result;
    }
  );
}
async function copyTranslation(): Promise<void> {
  const result = translation.value;
  if (!result) return;
  copied.value = false;
  copyFailed.value = false;
  try {
    const clipboard = globalThis.navigator.clipboard as Clipboard | undefined;
    if (!clipboard) throw new Error('CLIPBOARD_UNAVAILABLE');
    await clipboard.writeText(result.text);
    if (translation.value === result) copied.value = true;
  } catch {
    if (translation.value === result) copyFailed.value = true;
  }
}
function close(): void {
  reset();
  emit('close');
}
function updateOpen(open: boolean): void {
  if (!open) close();
}
function determinacy(value: boolean | null): string {
  return value === null ? pr('unknown') : value ? pr('certain') : pr('uncertain');
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="pr(kind === 'translation' ? 'translationTitle' : 'shippingTitle')"
    :description="pr('topHint')"
    size="lg"
    @update:open="updateOpen"
  >
    <div class="space-y-4 text-sm" :aria-busy="busy">
      <p class="rounded-md border bg-muted/40 p-3 text-muted-foreground">{{ pr('topHint') }}</p>
      <template v-if="kind === 'translation'">
        <p>{{ pr('translationHint') }}</p>
        <p class="text-muted-foreground">{{ pr('recognitionUnavailable') }}</p>
        <form class="space-y-3" @submit.prevent="translate">
          <label class="block space-y-1">
            <span>{{ pr('appName') }}</span>
            <Input
              v-model="appName"
              data-field="appName"
              :aria-label="pr('appName')"
              autocomplete="off"
              required
            />
            <span class="block text-xs text-muted-foreground">{{ pr('appNameHint') }}</span>
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="block space-y-1"
              ><span>{{ pr('sourceLanguage') }}</span>
              <Input
                v-model="sourceLanguage"
                data-field="sourceLanguage"
                :aria-label="pr('sourceLanguage')"
                placeholder="en"
                required
              />
            </label>
            <label class="block space-y-1"
              ><span>{{ pr('targetLanguage') }}</span>
              <Input
                v-model="targetLanguage"
                data-field="targetLanguage"
                :aria-label="pr('targetLanguage')"
                placeholder="es"
                required
              />
            </label>
          </div>
          <label class="block space-y-1"
            ><span>{{ pr('fieldType') }}</span>
            <select
              v-model="fieldType"
              data-field="fieldType"
              class="h-9 w-full rounded-md border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="pr('fieldType')"
            >
              <option value="title">{{ pr('titleField') }}</option>
              <option value="offer">{{ pr('descriptionField') }}</option>
            </select>
          </label>
          <label class="block space-y-1"
            ><span>{{ pr('sourceText') }}</span>
            <textarea
              v-model="sourceText"
              data-field="sourceText"
              :aria-label="pr('sourceText')"
              class="min-h-28 w-full rounded-md border bg-background p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </label>
          <p v-if="!translationValid" class="text-xs text-muted-foreground">{{ pr('invalid') }}</p>
          <Button type="submit" data-action="translate" :disabled="busy || !translationValid">{{
            pr('translate')
          }}</Button>
        </form>
        <section
          v-if="translation"
          data-result="translation"
          class="space-y-2 rounded-md border p-3"
          aria-live="polite"
        >
          <h3 class="font-medium">
            {{ pr('result') }} · {{ translation.sourceLanguage }} → {{ translation.targetLanguage }}
          </h3>
          <pre class="whitespace-pre-wrap break-words font-sans" tabindex="0">{{ translation.text }}</pre>
          <p class="break-all text-xs text-muted-foreground">{{ pr('trace') }}: {{ translation.traceId }}</p>
          <Button variant="outline" data-action="copy" @click="copyTranslation">{{
            pr(copied ? 'copied' : 'copy')
          }}</Button>
          <p v-if="copyFailed" role="status">{{ pr('copyFailed') }}</p>
        </section>
      </template>
      <template v-else>
        <p>{{ pr('shippingHint') }}</p>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" data-action="templates" :disabled="busy" @click="loadTemplates">{{
            pr('loadTemplates')
          }}</Button>
          <Button variant="outline" data-action="countries" :disabled="busy" @click="loadCountries">{{
            pr('loadCountries')
          }}</Button>
        </div>
        <form class="space-y-3" @submit.prevent="queryCoverage">
          <label class="block space-y-1"
            ><span>{{ pr('templateId') }}</span>
            <select
              v-if="templates.length"
              v-model="shippingTemplateId"
              class="h-9 w-full rounded-md border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="pr('chooseTemplate')"
            >
              <option value="">{{ pr('chooseTemplate') }}</option>
              <option v-for="template in templates" :key="template.id" :value="template.id">
                {{ template.name }} · {{ template.id }}
              </option>
            </select>
            <Input
              v-model="shippingTemplateId"
              data-field="templateId"
              :aria-label="pr('templateId')"
              inputmode="numeric"
              required
            />
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label
              v-for="field in [
                { key: 'weight', model: weight },
                { key: 'length', model: length },
                { key: 'width', model: width },
                { key: 'height', model: height }
              ]"
              :key="field.key"
              class="block space-y-1"
            >
              <span>{{ pr(field.key as 'weight' | 'length' | 'width' | 'height') }}</span>
              <Input
                :model-value="field.model"
                :data-field="field.key"
                :aria-label="pr(field.key as 'weight' | 'length' | 'width' | 'height')"
                inputmode="decimal"
                required
                @update:model-value="
                  (value) => {
                    if (field.key === 'weight') weight = String(value);
                    else if (field.key === 'length') length = String(value);
                    else if (field.key === 'width') width = String(value);
                    else height = String(value);
                  }
                "
              />
            </label>
            <label class="block space-y-1"
              ><span>{{ pr('moq') }}</span
              ><Input v-model="moq" data-field="moq" :aria-label="pr('moq')" inputmode="decimal" required
            /></label>
            <label class="block space-y-1"
              ><span>{{ pr('saleType') }}</span>
              <select
                v-model="saleType"
                data-field="saleType"
                class="h-9 w-full rounded-md border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="pr('saleType')"
              >
                <option value="normal">{{ pr('normalSale') }}</option>
                <option value="batch">{{ pr('batchSale') }}</option>
              </select>
            </label>
            <label v-if="saleType === 'batch'" class="block space-y-1"
              ><span>{{ pr('batchNum') }}</span
              ><Input
                v-model="batchNum"
                data-field="batchNum"
                :aria-label="pr('batchNum')"
                inputmode="numeric"
                required
            /></label>
            <label class="block space-y-1"
              ><span>{{ pr('productType') }}</span>
              <select
                v-model="productType"
                data-field="productType"
                class="h-9 w-full rounded-md border bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="pr('productType')"
                required
              >
                <option value="">{{ pr('chooseProductType') }}</option>
                <option value="1">{{ pr('directProduct') }}</option>
                <option value="2">{{ pr('customProduct') }}</option>
              </select>
            </label>
            <label class="block space-y-1"
              ><span>{{ pr('resultLanguage') }}</span
              ><Input
                v-model="resultLanguage"
                data-field="resultLanguage"
                :aria-label="pr('resultLanguage')"
                placeholder="zh_cn"
            /></label>
          </div>
          <p v-if="!shippingValid" class="text-xs text-muted-foreground">{{ pr('invalid') }}</p>
          <Button type="submit" data-action="coverage" :disabled="busy || !shippingValid">{{
            pr('queryCoverage')
          }}</Button>
        </form>
        <section v-if="countries" data-result="countries" class="space-y-2">
          <h3 class="font-medium">{{ pr('countries') }}</h3>
          <p v-if="!countries.items.length">{{ pr('empty') }}</p>
          <ul v-else class="max-h-48 overflow-y-auto rounded-md border p-3">
            <li v-for="(country, index) in countries.items" :key="index">
              {{ country.continentName ?? country.continentCode ?? '—' }} · {{ country.name }} ({{
                country.code
              }})
            </li>
          </ul>
          <p class="break-all text-xs text-muted-foreground">{{ pr('trace') }}: {{ countries.traceId }}</p>
        </section>
        <section v-if="coverage" data-result="coverage" class="space-y-2" aria-live="polite">
          <h3 class="font-medium">{{ pr('coverage') }}</h3>
          <p v-if="!coverage.items.length">{{ pr('empty') }}</p>
          <div v-else class="max-h-64 overflow-auto rounded-md border">
            <table class="w-full text-left">
              <thead>
                <tr class="border-b">
                  <th scope="col" class="p-2">{{ pr('country') }}</th>
                  <th scope="col" class="p-2">{{ pr('core') }}</th>
                  <th scope="col" class="p-2">{{ pr('determinacy') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(country, index) in coverage.items" :key="index" class="border-b last:border-0">
                  <th scope="row" class="p-2 font-normal">{{ country.name }} ({{ country.code }})</th>
                  <td class="p-2">{{ pr(country.core ? 'core' : 'nonCore') }}</td>
                  <td class="p-2">{{ determinacy(country.freightCertain) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="break-all text-xs text-muted-foreground">{{ pr('trace') }}: {{ coverage.traceId }}</p>
        </section>
      </template>
      <p v-if="busy" role="status">{{ pr('busy') }}</p>
      <div
        v-if="failure"
        role="alert"
        class="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
      >
        <p>{{ pr(permissionDenied ? 'permissionDenied' : 'failed') }}</p>
        <p>{{ pr('permissionHint') }}</p>
        <p v-if="failureCode" class="break-all font-mono text-xs">{{ failureCode }}</p>
        <p v-if="failureSubCode" class="break-all font-mono text-xs">{{ failureSubCode }}</p>
        <p v-if="failure.traceId" class="break-all text-xs">{{ pr('trace') }}: {{ failure.traceId }}</p>
      </div>
    </div>
    <template #footer
      ><Button variant="outline" data-action="close" @click="close">{{ pr('close') }}</Button></template
    >
  </ModalDialog>
</template>
