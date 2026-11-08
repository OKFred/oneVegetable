<script setup lang="ts">
import '../i18n/shipping-services';
import { computed, onBeforeUnmount, reactive, ref, shallowRef, useId, watch } from 'vue';
import { toast } from 'vue-sonner';
import {
  parseShippingServicesRequest,
  type ShippingMode,
  type ShippingProviderConfigurationSummary,
  type ShippingQuoteRequest,
  type ShippingQuoteResult,
  type ShippingShipment
} from '@one-vegetable/core/shipping-services';
import { filterChinaShippingServices } from '@one-vegetable/core/shipping-directory';
import { hasUiTranslation, useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import { formatDateTime } from '../lib/date-time';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import Sheet from './ui/Sheet.vue';

const props = defineProps<{ active: boolean }>();
const { shippingServices } = useServices();
const { t, locale } = useUiI18n();
const modes: ShippingMode[] = ['express', 'parcel', 'air', 'lcl', 'fcl'];
const mode = ref<ShippingMode>('air');
const keyword = ref('');
const countryListId = useId();
const countryOptions = computed(() => {
  const names = [locale.value, 'en-US', 'zh-CN'].map(
    (value) => new Intl.DisplayNames([value], { type: 'region' })
  );
  return 'US GB DE FR IT ES NL BE PL SE NO DK CH AT CA AU NZ JP KR SG MY TH VN ID PH AE SA IN BR MX ZA HK TW'
    .split(' ')
    .map((code) => {
      const labels = names.map((value) => value.of(code) ?? code);
      return {
        code,
        label: (labels[0] ?? code) + ' (' + code + ')',
        aliases: [code, ...labels, ...labels.map((value) => value + ' (' + code + ')')]
      };
    });
});
function destinationCountryCode(): string {
  const value = draft.destinationCountry.trim().toLowerCase();
  return (
    countryOptions.value.find((country) => country.aliases.some((alias) => alias.toLowerCase() === value))
      ?.code ?? draft.destinationCountry.trim().toUpperCase()
  );
}
const draft = reactive({
  originProvince: '',
  originCity: '',
  originPostal: '',
  destinationCountry: '',
  destinationProvince: '',
  destinationCity: '',
  destinationPostal: '',
  packaging: ref<ShippingShipment['packaging']>('boxes'),
  quantity: '1',
  weightKg: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  declaredValue: '',
  currency: 'CNY',
  pickupDate: ''
});
const canEstimate = computed(() => ['air', 'lcl', 'fcl'].includes(mode.value));
const container = computed(() => mode.value === 'fcl');
const entries = computed(() => filterChinaShippingServices({ mode: mode.value, keyword: keyword.value }));
const locationFields = [
  'originProvince',
  'originCity',
  'originPostal',
  'destinationCountry',
  'destinationProvince',
  'destinationCity',
  'destinationPostal'
] as const;
const cargoFields = computed(
  () =>
    [
      'quantity',
      ...(!container.value ? (['weightKg', 'lengthCm', 'widthCm', 'heightCm'] as const) : []),
      'declaredValue',
      'pickupDate'
    ] as const
);
const numericFields = ['quantity', 'weightKg', 'lengthCm', 'widthCm', 'heightCm', 'declaredValue'];
const summary = shallowRef<ShippingProviderConfigurationSummary | null>(null);
const configOpen = ref(false);
const apiKey = ref('');
const termsAccepted = ref(false);
const configCostAccepted = ref(false);
const clearRevision = ref<number | null>(null);
const busy = ref<'configuration' | 'save' | 'clear' | 'quote' | null>(null);
const pending = shallowRef<ShippingQuoteRequest | null>(null);
const result = shallowRef<ShippingQuoteResult | null>(null);
const receivedQuote = ref(false);
const dataAccepted = ref(false);
const quoteCostAccepted = ref(false);
const confirmation = computed(() => {
  if (!pending.value) return null;
  const { requestId, provider, expectedRevision, shipment } = pending.value;
  const location = (value: ShippingShipment['origin']) => ({
    countryCode: value.countryCode,
    city: value.city,
    ...(value.state ? { state: value.state } : {}),
    ...(value.postalCode ? { postalCode: value.postalCode } : {})
  });
  return {
    requestId,
    provider,
    expectedRevision,
    shipment: {
      origin: location(shipment.origin),
      destination: location(shipment.destination),
      mode: shipment.mode,
      packaging: shipment.packaging,
      quantity: shipment.quantity,
      ...(!shipment.packaging.startsWith('container')
        ? {
            weightKg: shipment.weightKg,
            lengthCm: shipment.lengthCm,
            widthCm: shipment.widthCm,
            heightCm: shipment.heightCm
          }
        : {}),
      ...(shipment.pickupDate ? { pickupDate: shipment.pickupDate } : {}),
      ...(shipment.declaredValue > 0 ? { declaredValue: shipment.declaredValue } : {}),
      currency: shipment.currency
    },
    consent: { dataSharing: dataAccepted.value, costAcknowledged: quoteCostAccepted.value }
  };
});
const errorCode = ref('');
let generation = 0;
let configGeneration = 0;
let disposed = false;
function isCurrent(current: number): boolean {
  return !disposed && props.active && current === generation;
}
function isConfigurationCurrent(current: number): boolean {
  return !disposed && props.active && configOpen.value && current === configGeneration;
}

const errorMessage = computed(() => {
  const key = 'errors.codes.' + errorCode.value;
  return hasUiTranslation(key) ? t(key) : t('shippingServices.failed');
});
function fail(cause: unknown): void {
  const code =
    cause && typeof cause === 'object' && 'code' in cause
      ? String(cause.code)
      : cause instanceof Error
        ? cause.message
        : '';
  // Never render an upstream message, key or provider response.
  errorCode.value = /^SHIPPING_[A-Z0-9_]+$/u.test(code) ? code : 'SHIPPING_SERVICES_FAILED';
}
function invalidate(): void {
  generation++;
  pending.value = null;
  result.value = null;
  dataAccepted.value = false;
  quoteCostAccepted.value = false;
  errorCode.value = '';
}
function closeConfiguration(): void {
  configOpen.value = false;
  configGeneration++;
  apiKey.value = '';
  termsAccepted.value = false;
  configCostAccepted.value = false;
}
watch([draft, mode], invalidate, { deep: true, flush: 'sync' });
watch(
  mode,
  (value) => {
    draft.packaging = value === 'fcl' ? 'container20' : 'boxes';
  },
  { flush: 'sync' }
);
watch(
  () => props.active,
  (active) => {
    if (!active) {
      invalidate();
      closeConfiguration();
      clearRevision.value = null;
    }
  },
  { flush: 'sync' }
);
onBeforeUnmount(() => {
  disposed = true;
  invalidate();
  closeConfiguration();
});

async function openConfiguration(): Promise<void> {
  if (!props.active || busy.value) return;
  invalidate();
  closeConfiguration();
  configOpen.value = true;
  summary.value = null;
  if (!shippingServices) return;
  const current = ++configGeneration;
  busy.value = 'configuration';
  try {
    const value = await shippingServices.configuration('freightos');
    if (isConfigurationCurrent(current)) summary.value = value;
  } catch (cause) {
    if (isConfigurationCurrent(current)) fail(cause);
  } finally {
    busy.value = null;
  }
}
async function saveConfiguration(): Promise<void> {
  if (
    !shippingServices ||
    !props.active ||
    !configOpen.value ||
    busy.value ||
    !summary.value ||
    !apiKey.value.trim() ||
    !termsAccepted.value ||
    !configCostAccepted.value
  )
    return;
  const current = configGeneration;
  const input = {
    provider: 'freightos' as const,
    apiKey: apiKey.value.trim(),
    expectedRevision: summary.value.revision,
    termsAccepted: termsAccepted.value,
    costAcknowledged: configCostAccepted.value
  };
  busy.value = 'save';
  invalidate();
  try {
    const value = await shippingServices.saveConfiguration(input);
    if (isConfigurationCurrent(current)) {
      summary.value = value;
      toast.success(t('shippingServices.saved'));
    }
  } catch (cause) {
    if (isConfigurationCurrent(current)) {
      summary.value = null;
      fail(cause);
    }
  } finally {
    apiKey.value = '';
    termsAccepted.value = false;
    configCostAccepted.value = false;
    busy.value = null;
  }
}
function askClear(): void {
  if (busy.value || !summary.value?.configured || summary.value.revision === null) return;
  const revision = summary.value.revision;
  closeConfiguration();
  clearRevision.value = revision;
}
async function clearConfiguration(): Promise<void> {
  if (!shippingServices || !props.active || busy.value || clearRevision.value === null) return;
  const revision = clearRevision.value;
  const current = generation;
  busy.value = 'clear';
  try {
    await shippingServices.clearConfiguration('freightos', revision);
    if (isCurrent(current)) {
      summary.value = null;
      invalidate();
      toast.success(t('shippingServices.cleared'));
    }
  } catch (cause) {
    if (isCurrent(current)) {
      summary.value = null;
      fail(cause);
    }
  } finally {
    clearRevision.value = null;
    busy.value = null;
  }
}
function reviewQuote(): void {
  if (
    !shippingServices ||
    !props.active ||
    busy.value ||
    !canEstimate.value ||
    !summary.value?.configured ||
    summary.value.revision === null
  )
    return;
  invalidate();
  try {
    const shipment: ShippingShipment = {
      origin: {
        countryCode: 'CN',
        state: draft.originProvince.trim(),
        city: draft.originCity.trim(),
        postalCode: draft.originPostal.trim()
      },
      destination: {
        countryCode: destinationCountryCode(),
        state: draft.destinationProvince.trim(),
        city: draft.destinationCity.trim(),
        postalCode: draft.destinationPostal.trim()
      },
      mode: mode.value,
      packaging: draft.packaging,
      quantity: Number(draft.quantity),
      weightKg: container.value ? 0 : Number(draft.weightKg),
      lengthCm: container.value ? 0 : Number(draft.lengthCm),
      widthCm: container.value ? 0 : Number(draft.widthCm),
      heightCm: container.value ? 0 : Number(draft.heightCm),
      description: '',
      hsCode: '',
      declaredValue: Number(draft.declaredValue),
      currency: draft.currency,
      pickupDate: draft.pickupDate
    };
    const request = {
      requestId: globalThis.crypto.randomUUID(),
      provider: 'freightos' as const,
      expectedRevision: summary.value.revision,
      shipment,
      consent: { dataSharing: false, costAcknowledged: false }
    };
    parseShippingServicesRequest({
      action: 'quote',
      ...request,
      consent: { dataSharing: true, costAcknowledged: true }
    });
    Object.freeze(shipment.origin);
    Object.freeze(shipment.destination);
    Object.freeze(shipment);
    Object.freeze(request.consent);
    pending.value = Object.freeze(request);
  } catch (cause) {
    fail(cause);
  }
}
function closeQuote(): void {
  pending.value = null;
  dataAccepted.value = false;
  quoteCostAccepted.value = false;
}
async function sendQuote(): Promise<void> {
  if (
    !shippingServices ||
    !props.active ||
    busy.value ||
    !pending.value ||
    !dataAccepted.value ||
    !quoteCostAccepted.value
  )
    return;
  const input = Object.freeze({
    ...pending.value,
    consent: Object.freeze({ dataSharing: true, costAcknowledged: true })
  });
  const current = generation;
  closeQuote();
  busy.value = 'quote';
  try {
    const value = await shippingServices.quote(input);
    if (isCurrent(current) && value.requestId === input.requestId) {
      result.value = value;
      receivedQuote.value = true;
    }
  } catch (cause) {
    if (isCurrent(current)) fail(cause);
  } finally {
    busy.value = null;
  }
}
function downloadOnboarding(): void {
  const text = [
    t('shippingServices.onboarding'),
    t('shippingServices.onboardingSteps'),
    t('shippingServices.fees'),
    t('shippingServices.livePending'),
    'https://ship.freightos.com/api/shippingCalculator',
    'https://www.freightos.com/freightos-data-terms-conditions/'
  ].join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = 'freightos-onboarding.txt';
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="min-w-0 space-y-4" data-testid="shipping-services-workspace">
    <Card class="space-y-3 p-5" data-testid="shipping-directory">
      <h2 class="text-lg font-semibold">{{ t('shippingServices.title') }}</h2>
      <p class="text-sm">{{ t('shippingServices.independentNotice') }}</p>
      <details class="text-sm text-muted-foreground">
        <summary class="cursor-pointer font-medium">{{ t('shippingServices.directoryDetails') }}</summary>
        <div class="mt-2 space-y-2">
          <p>{{ t('shippingServices.directoryDisclaimer') }}</p>
          <p>{{ t('shippingServices.localPrivacy') }}</p>
        </div>
      </details>
      <div class="grid gap-3 sm:grid-cols-3" data-testid="shipping-discovery-controls">
        <label class="space-y-1 text-sm">
          <span>{{ t('shippingServices.originCountry') }}</span>
          <Input
            :model-value="t('shippingServices.mainlandChina')"
            readonly
            :aria-label="t('shippingServices.originCountry')"
          />
        </label>
        <label class="space-y-1 text-sm">
          <span>{{ t('shippingServices.mode') }}</span>
          <select
            v-model="mode"
            class="h-9 w-full rounded-md border bg-background px-3 text-sm"
            data-testid="shipping-mode"
          >
            <option v-for="value in modes" :key="value" :value="value">
              {{ t('shippingServices.modes.' + value) }}
            </option>
          </select>
        </label>
        <label class="space-y-1 text-sm">
          <span>{{ t('shippingServices.keyword') }}</span>
          <Input v-model="keyword" data-testid="shipping-keyword" />
        </label>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card
          v-for="entry in entries"
          :key="entry.id"
          class="min-w-0 space-y-2 p-4"
          :data-testid="'shipping-directory-' + entry.id"
        >
          <h3 class="font-semibold">{{ t('shippingServices.names.' + entry.id) }}</h3>
          <p class="text-xs text-muted-foreground">
            {{ t('shippingServices.kinds.' + entry.kind) }} ·
            {{ entry.modes.map((value) => t('shippingServices.modes.' + value)).join(' / ') }}
          </p>
          <div class="text-sm">
            <a
              :href="entry.websiteUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary underline"
              >{{ t('shippingServices.officialWebsite') }}</a
            >
          </div>
          <details class="text-xs text-muted-foreground">
            <summary class="cursor-pointer font-medium">{{ t('shippingServices.serviceDetails') }}</summary>
            <div class="mt-2 space-y-2">
              <p>{{ t('shippingServices.coverage.' + entry.coverage) }}</p>
              <a
                :href="entry.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary underline"
                >{{ t('shippingServices.source') }}</a
              >
              <p>{{ t('shippingServices.checkedOn', { date: entry.checkedOn }) }}</p>
            </div>
          </details>
        </Card>
      </div>
      <p v-if="!entries.length" role="status" class="text-sm text-muted-foreground">
        {{ t('shippingServices.directoryEmpty') }}
      </p>
    </Card>

    <Card class="space-y-4 p-5">
      <h2 class="font-semibold">Freightos · {{ t('shippingServices.marketEstimate') }}</h2>
      <p
        v-if="!receivedQuote"
        class="text-sm text-muted-foreground"
        data-testid="shipping-acceptance-pending"
      >
        {{ t('shippingServices.livePending') }}
      </p>
      <p class="text-sm">{{ t('shippingServices.estimateNotice') }}</p>
      <details class="text-sm text-muted-foreground" data-testid="shipping-estimate-details">
        <summary class="cursor-pointer font-medium">{{ t('shippingServices.estimateDetails') }}</summary>
        <div class="mt-2 space-y-2">
          <p>{{ t('shippingServices.estimateDisclaimer') }}</p>
          <p>{{ t('shippingServices.fees') }}</p>
        </div>
      </details>
      <p v-if="!shippingServices" class="text-sm text-muted-foreground">
        {{ t('shippingServices.unavailable') }}
      </p>
      <Button
        variant="outline"
        :disabled="Boolean(busy)"
        data-testid="shipping-configure"
        @click="openConfiguration"
        >{{ t('shippingServices.configure') }}</Button
      >
      <p v-if="summary" role="status" class="text-sm">
        {{ t(summary.configured ? 'shippingServices.configured' : 'shippingServices.notConfigured') }} ·
        {{ t('shippingServices.revision', { revision: summary.revision ?? '—' }) }}
      </p>
      <p v-if="!canEstimate" role="status" class="text-sm">{{ t('shippingServices.websiteOnly') }}</p>
      <form
        v-else
        class="space-y-4"
        data-feedback-redact
        data-testid="shipping-estimate-form"
        @submit.prevent="reviewQuote"
      >
        <fieldset class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <legend class="mb-3 text-sm font-medium">{{ t('shippingServices.route') }}</legend>
          <label v-for="field in locationFields" :key="field" class="space-y-1 text-sm">
            <span>{{ t('shippingServices.fields.' + field) }}</span>
            <Input
              v-model="draft[field]"
              :data-testid="'shipping-' + field"
              maxlength="120"
              :list="field === 'destinationCountry' ? countryListId : undefined"
              :placeholder="field === 'destinationCountry' ? t('shippingServices.countryExample') : ''"
              autocomplete="off"
            />
            <p v-if="field === 'destinationCountry'" class="text-xs text-muted-foreground">
              {{ t('shippingServices.countryHelp') }}
            </p>
          </label>
        </fieldset>
        <datalist :id="countryListId">
          <option v-for="country in countryOptions" :key="country.code" :value="country.label" />
        </datalist>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label class="space-y-1 text-sm">
            <span>{{ t('shippingServices.packaging') }}</span>
            <select
              v-model="draft.packaging"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm"
              data-testid="shipping-packaging"
            >
              <option
                v-for="value in container
                  ? ['container20', 'container40', 'container40HC']
                  : ['boxes', 'pallets']"
                :key="value"
                :value="value"
              >
                {{ t('shippingServices.packages.' + value) }}
              </option>
            </select>
          </label>
          <label v-for="field in cargoFields" :key="field" class="space-y-1 text-sm">
            <span>{{ t('shippingServices.fields.' + field) }}</span>
            <Input
              v-model="draft[field]"
              :data-testid="'shipping-' + field"
              :type="field === 'pickupDate' ? 'date' : 'text'"
              :inputmode="numericFields.includes(field) ? 'decimal' : 'text'"
              maxlength="200"
              autocomplete="off"
            />
          </label>
          <label class="space-y-1 text-sm">
            <span>{{ t('shippingServices.currency') }}</span>
            <select
              v-model="draft.currency"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm"
              data-testid="shipping-currency"
            >
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
        </div>
        <p class="text-xs text-muted-foreground">{{ t('shippingServices.inputHelp') }}</p>
        <Button
          type="submit"
          :disabled="!shippingServices || !summary?.configured || Boolean(busy)"
          data-testid="shipping-review"
          >{{ t('shippingServices.review') }}</Button
        >
      </form>
      <p v-if="busy" role="status" class="text-sm">{{ t('shippingServices.processing') }}</p>
      <div
        v-if="errorCode"
        role="alert"
        class="break-words rounded-md border border-destructive/30 p-3 text-sm text-destructive dark:text-red-300"
      >
        {{ errorMessage }} <code>{{ errorCode }}</code>
      </div>
      <div v-if="result" class="space-y-3" data-testid="shipping-results" aria-live="polite">
        <p class="break-all text-xs">Freightos · {{ result.requestId }}</p>
        <p class="text-xs text-muted-foreground" data-testid="shipping-quoted-at">
          {{
            t('shippingServices.quotedAt', {
              time: formatDateTime(result.quotedAtUtc, t('shippingServices.notReturned'))
            })
          }}
        </p>
        <p v-if="!result.options.length" role="status">{{ t('shippingServices.noRates') }}</p>
        <Card v-for="option in result.options" :key="option.id" class="space-y-1 p-4">
          <h3 class="font-semibold">{{ option.serviceName }} · {{ option.mode }}</h3>
          <p class="text-sm">{{ t('shippingServices.marketEstimate') }}</p>
          <p class="text-lg font-semibold">
            {{
              option.amount !== null && option.currency
                ? option.currency + ' ' + option.amount
                : t('shippingServices.notReturned')
            }}
          </p>
          <p class="text-sm">
            {{
              option.transitDaysFrom !== null && option.transitDaysTo !== null
                ? t('shippingServices.transit', { from: option.transitDaysFrom, to: option.transitDaysTo })
                : t('shippingServices.notReturned')
            }}
          </p>
        </Card>
        <p class="text-xs text-muted-foreground">{{ t('shippingServices.estimateDisclaimer') }}</p>
        <a
          href="https://ship.freightos.com/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-primary underline"
          >{{ t('shippingServices.freightosAttribution') }}</a
        >
      </div>
    </Card>

    <Sheet
      :open="configOpen"
      :title="t('shippingServices.configure')"
      :description="t('shippingServices.onboarding')"
      size="md"
      @update:open="
        (value) => {
          if (!value) closeConfiguration();
        }
      "
    >
      <div class="space-y-4">
        <h3 class="font-semibold">{{ t('shippingServices.onboarding') }}</h3>
        <p class="whitespace-pre-line text-sm">{{ t('shippingServices.onboardingSteps') }}</p>
        <div class="flex flex-wrap gap-3 text-sm">
          <a
            href="https://ship.freightos.com/api/shippingCalculator"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline"
            >{{ t('shippingServices.apiGuide') }}</a
          >
          <a
            href="https://www.freightos.com/freightos-data-terms-conditions/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline"
            >{{ t('shippingServices.termsLink') }}</a
          >
          <Button variant="outline" size="sm" @click="downloadOnboarding">{{
            t('shippingServices.downloadGuide')
          }}</Button>
        </div>
        <p class="text-sm text-muted-foreground">{{ t('shippingServices.fees') }}</p>
        <p class="text-sm text-muted-foreground">{{ t('shippingServices.keyPrivacy') }}</p>
        <p v-if="summary" role="status" class="text-sm">
          {{ t(summary.configured ? 'shippingServices.configured' : 'shippingServices.notConfigured') }} ·
          {{ t('shippingServices.revision', { revision: summary.revision ?? '—' }) }}
        </p>
        <p v-if="!shippingServices" class="text-sm">{{ t('shippingServices.unavailable') }}</p>
        <form class="space-y-4" @submit.prevent="saveConfiguration">
          <label class="block space-y-1 text-sm" data-feedback-redact>
            <span>{{ t('shippingServices.apiKey') }}</span>
            <Input
              v-model="apiKey"
              type="password"
              data-feedback-redact
              autocomplete="new-password"
              data-testid="shipping-api-key"
            />
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input v-model="termsAccepted" type="checkbox" class="mt-1" data-testid="shipping-config-terms" />
            <span>{{ t('shippingServices.acceptTerms') }}</span>
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input
              v-model="configCostAccepted"
              type="checkbox"
              class="mt-1"
              data-testid="shipping-config-cost"
            />
            <span>{{ t('shippingServices.acceptConfigCost') }}</span>
          </label>
          <div class="flex flex-wrap gap-2">
            <Button
              type="submit"
              :disabled="
                !shippingServices ||
                !summary ||
                !apiKey.trim() ||
                !termsAccepted ||
                !configCostAccepted ||
                Boolean(busy)
              "
              data-testid="shipping-save"
              >{{ t('shippingServices.save') }}</Button
            >
            <Button
              v-if="summary?.configured"
              variant="destructive"
              :disabled="Boolean(busy)"
              data-testid="shipping-clear"
              @click="askClear"
              >{{ t('shippingServices.clear') }}</Button
            >
          </div>
        </form>
        <div v-if="errorCode" role="alert" class="break-words text-sm text-destructive dark:text-red-300">
          {{ errorMessage }} <code>{{ errorCode }}</code>
        </div>
      </div>
    </Sheet>

    <Sheet
      :open="Boolean(pending)"
      :title="t('shippingServices.confirmTitle')"
      :description="t('shippingServices.confirmDescription')"
      size="md"
      @update:open="
        (value) => {
          if (!value) closeQuote();
        }
      "
    >
      <div v-if="pending" class="space-y-4">
        <p class="font-semibold">Freightos · {{ t('shippingServices.marketEstimate') }}</p>
        <pre
          class="overflow-x-auto whitespace-pre-wrap break-all rounded-md border p-3 text-xs"
          data-feedback-redact
          data-testid="shipping-frozen-request"
          >{{ JSON.stringify(confirmation, null, 2) }}</pre>
        <p class="text-sm">{{ t('shippingServices.fees') }}</p>
        <p class="text-sm">{{ t('shippingServices.estimateDisclaimer') }}</p>
        <label class="flex items-start gap-2 text-sm">
          <input v-model="dataAccepted" type="checkbox" class="mt-1" data-testid="shipping-quote-data" />
          <span>{{ t('shippingServices.acceptData') }}</span>
        </label>
        <label class="flex items-start gap-2 text-sm">
          <input v-model="quoteCostAccepted" type="checkbox" class="mt-1" data-testid="shipping-quote-cost" />
          <span>{{ t('shippingServices.acceptQuoteCost') }}</span>
        </label>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" @click="closeQuote">{{ t('common.actions.cancel') }}</Button>
          <Button
            :disabled="!dataAccepted || !quoteCostAccepted || Boolean(busy)"
            data-testid="shipping-send"
            @click="sendQuote"
            >{{ t('shippingServices.sendOnce') }}</Button
          >
        </div>
      </div>
    </Sheet>

    <ConfirmActionDialog
      :open="clearRevision !== null"
      :title="t('shippingServices.clearTitle')"
      :description="t('shippingServices.clearDescription')"
      destructive
      :pending="busy === 'clear'"
      @update:open="
        (value) => {
          if (!value) clearRevision = null;
        }
      "
      @confirm="clearConfiguration"
    />
  </section>
</template>
