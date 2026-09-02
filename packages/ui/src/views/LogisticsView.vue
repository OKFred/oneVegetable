<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { Calculator, ClipboardList, MapPin, PackageCheck, RefreshCw, ShieldAlert, Truck } from '@lucide/vue';
import { toast } from 'vue-sonner';

import type { LogisticsOrderSummary, LogisticsQuoteRequest } from '@one-vegetable/core';

import ActionTooltip from '../components/ActionTooltip.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import Sheet from '../components/ui/Sheet.vue';
import { useUiI18n } from '../i18n';
import {
  operationAvailabilityMessage,
  useOperationAvailability
} from '../composables/use-operation-availability';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

type Workspace = 'quote' | 'orders' | 'addresses' | 'draft';

const { gateway } = useServices();
const { t } = useUiI18n();
const workspace = ref<Workspace>('quote');
const logisticsOperations = useOperationAvailability([
  'listLogisticsAddressNodes',
  'listLogisticsSpecialProductTypes',
  'listLogisticsProducts',
  'calculateLogisticsQuote',
  'listLogisticsOrders',
  'getLogisticsOrder',
  'listShippingTemplates',
  'createLogisticsOrder'
]);
const quoteBlocked = computed(() => !logisticsOperations.isAllowed('calculateLogisticsQuote'));
const ordersBlocked = computed(() => !logisticsOperations.isAllowed('listLogisticsOrders'));
const addressNodesBlocked = computed(() => !logisticsOperations.isAllowed('listLogisticsAddressNodes'));
const createOrderBlocked = computed(() => !logisticsOperations.isAllowed('createLogisticsOrder'));
const logisticsRestrictionReason = computed(() =>
  operationAvailabilityMessage(
    logisticsOperations.reasonCode('calculateLogisticsQuote'),
    t('logistics.errors.quoteUnavailable')
  )
);
const quoteDisabledReason = computed(() => {
  if (quoteBlocked.value) return logisticsRestrictionReason.value;
  if (calculateQuote.isPending.value) return t('logistics.errors.quoting');
  return '';
});
const ordersDisabledReason = computed(() => {
  if (ordersBlocked.value) {
    return operationAvailabilityMessage(
      logisticsOperations.reasonCode('listLogisticsOrders'),
      t('logistics.errors.ordersUnavailable')
    );
  }
  if (orders.isFetching.value) return t('logistics.errors.ordersRefreshing');
  return '';
});
const createOrderDisabledReason = computed(() => {
  if (createOrderBlocked.value) {
    return operationAvailabilityMessage(
      logisticsOperations.reasonCode('createLogisticsOrder'),
      t('logistics.errors.createUnavailable')
    );
  }
  if (!selectedQuote.value) return t('logistics.errors.quoteFirst');
  if (createOrder.isPending.value) return t('logistics.errors.creating');
  return '';
});
const destinationCountryCode = ref('US');
const destinationZipCode = ref('07005');
const originZipCode = ref('518000');
const warehouseCode = ref('ASP_YH_SZJC');
const productCode = ref('EX_ASP_ePacket');
const packageLength = ref('40');
const packageWidth = ref('30');
const packageHeight = ref('25');
const packageWeight = ref('6.5');
const cargoNameCn = ref('无线耳机');
const cargoNameEn = ref('Wireless headphones');
const cargoHsCode = ref('85183000');
const cargoQuantity = ref('10');
const cargoValue = ref('18.50');
const cargoMaterial = ref('塑料和电子元件');
const selectedProductType = ref('battery');
const orderNumberFilter = ref('');
const logisticsOrderPage = ref(1);
const logisticsOrderPageSize = ref(20);
const selectedOrderNumber = ref('');
const logisticsOrderSheetOpen = ref(false);
const addressLevel = ref<'province' | 'city' | 'division' | 'street'>('province');
const addressParentId = ref('330000');
const addressSearchText = ref('仓前');
const consignorPerson = ref('演示发货人');
const consignorMobile = ref('13800000000');
const consignorAddress = ref('阿里西溪园区');
const consigneePerson = ref('演示收货人');
const consigneeMobile = ref('12025550123');
const consigneeAddress = ref('700 New Road');

const logisticsProducts = useQuery({
  queryKey: ['logistics-products'],
  enabled: computed(
    () =>
      logisticsOperations.isAllowed('listLogisticsProducts') &&
      (workspace.value === 'quote' || workspace.value === 'draft')
  ),
  queryFn: () => gateway.request('listLogisticsProducts', undefined)
});
const specialProductTypes = useQuery({
  queryKey: ['logistics-special-product-types'],
  enabled: computed(
    () =>
      logisticsOperations.isAllowed('listLogisticsSpecialProductTypes') &&
      (workspace.value === 'quote' || workspace.value === 'draft')
  ),
  queryFn: () => gateway.request('listLogisticsSpecialProductTypes', undefined)
});
const shippingTemplates = useQuery({
  queryKey: ['shipping-templates'],
  enabled: computed(
    () => logisticsOperations.isAllowed('listShippingTemplates') && workspace.value === 'addresses'
  ),
  queryFn: () => gateway.request('listShippingTemplates', undefined)
});
const orders = useQuery({
  queryKey: computed(() => [
    'logistics-orders',
    orderNumberFilter.value,
    logisticsOrderPage.value,
    logisticsOrderPageSize.value
  ]),
  enabled: computed(() => !ordersBlocked.value && workspace.value === 'orders'),
  queryFn: () =>
    gateway.request('listLogisticsOrders', {
      page: logisticsOrderPage.value,
      pageSize: logisticsOrderPageSize.value,
      ...(orderNumberFilter.value.trim() ? { orderNumber: orderNumberFilter.value.trim() } : {})
    })
});
const orderDetail = useQuery({
  queryKey: computed(() => ['logistics-order-detail', selectedOrderNumber.value]),
  enabled: computed(
    () => logisticsOperations.isAllowed('getLogisticsOrder') && selectedOrderNumber.value !== ''
  ),
  queryFn: () => gateway.request('getLogisticsOrder', { orderNumber: selectedOrderNumber.value })
});
const selectedLogisticsOrder = computed(() =>
  (orders.data.value?.items ?? []).find((order) => order.orderNumber === selectedOrderNumber.value)
);
const addressNodes = useQuery({
  queryKey: computed(() => [
    'logistics-address-nodes',
    addressLevel.value,
    addressParentId.value,
    addressSearchText.value
  ]),
  enabled: computed(() => !addressNodesBlocked.value && workspace.value === 'addresses'),
  queryFn: () =>
    gateway.request('listLogisticsAddressNodes', {
      level: addressLevel.value,
      ...(addressLevel.value === 'province'
        ? { countryCode: 'CN' }
        : addressLevel.value === 'street'
          ? { searchText: addressSearchText.value.trim() }
          : { parentId: addressParentId.value.trim() })
    })
});

const calculateQuote = useMutation({
  mutationFn: () => gateway.request('calculateLogisticsQuote', buildQuoteRequest()),
  onSuccess: (result) => toast.success(t('logistics.feedback.quoteDone', { count: result.options.length }))
});
const selectedQuote = computed(() => calculateQuote.data.value?.options.find((option) => option.available));
const createOrder = useMutation({
  mutationFn: () => {
    const quote = selectedQuote.value;
    if (!quote) throw new Error(t('logistics.errors.quoteSelection'));
    return gateway.request('createLogisticsOrder', {
      quoteRequest: buildQuoteRequest(),
      confirmedProductCode: quote.productCode
    });
  },
  onSuccess: () => toast.success(t('logistics.feedback.orderSubmitted'))
});

function buildQuoteRequest(): LogisticsQuoteRequest {
  return {
    originZipCode: originZipCode.value.trim(),
    destinationCountryCode: destinationCountryCode.value.trim().toUpperCase(),
    destinationZipCode: destinationZipCode.value.trim(),
    warehouseCode: warehouseCode.value.trim(),
    productCode: productCode.value.trim(),
    cargo: [
      {
        nameCn: cargoNameCn.value.trim(),
        nameEn: cargoNameEn.value.trim(),
        hsCode: cargoHsCode.value.trim(),
        quantity: cargoQuantity.value.trim(),
        unit: 'pcs',
        declarationValue: cargoValue.value.trim(),
        currency: 'USD',
        purpose: '商品销售',
        material: cargoMaterial.value.trim(),
        productTypeCodes: selectedProductType.value ? [selectedProductType.value] : []
      }
    ],
    packages: [
      {
        quantity: '1',
        lengthCm: packageLength.value.trim(),
        widthCm: packageWidth.value.trim(),
        heightCm: packageHeight.value.trim(),
        weightKg: packageWeight.value.trim(),
        type: 'box'
      }
    ],
    consignor: {
      countryCode: 'CN',
      provinceCode: '330000',
      cityCode: '330100',
      divisionCode: '330108',
      streetCode: null,
      address1: consignorAddress.value.trim(),
      address2: null,
      zipCode: originZipCode.value.trim(),
      contact: {
        contactPerson: consignorPerson.value.trim(),
        mobileNo: consignorMobile.value.trim(),
        email: null,
        companyName: null
      }
    },
    consignee: {
      countryCode: destinationCountryCode.value.trim().toUpperCase(),
      provinceCode: null,
      cityCode: null,
      divisionCode: null,
      streetCode: null,
      address1: consigneeAddress.value.trim(),
      address2: null,
      zipCode: destinationZipCode.value.trim(),
      contact: {
        contactPerson: consigneePerson.value.trim(),
        mobileNo: consigneeMobile.value.trim(),
        email: null,
        companyName: null
      }
    },
    customs: {
      declarationAmount: String(Number(cargoValue.value || 0) * Number(cargoQuantity.value || 0)),
      declarationCurrency: 'USD',
      needCustomsClearance: true,
      vatType: null,
      vatNumber: null,
      taxpayerId: null,
      eoriNumber: null
    },
    needPickup: false,
    supplyChainBizId: '1001',
    tradeBizId: null,
    tradePlatform: 'ICBU'
  };
}

function formatLogisticsDateTime(value: string | null): string {
  return formatDateTime(value, t('logistics.documentNotReturned'));
}

function selectLogisticsOrder(order: LogisticsOrderSummary): void {
  selectedOrderNumber.value = order.orderNumber;
  logisticsOrderSheetOpen.value = true;
}

watch(orderNumberFilter, () => {
  logisticsOrderPage.value = 1;
});

watch([logisticsOrderPage, logisticsOrderPageSize], () => {
  logisticsOrderSheetOpen.value = false;
  selectedOrderNumber.value = '';
});

const columns = computed<DataColumn<LogisticsOrderSummary>[]>(() => [
  {
    accessorKey: 'orderNumber',
    header: t('logistics.columns.orderNumber'),
    cell: ({ row }) =>
      h(
        'button',
        {
          class: 'font-mono text-xs text-primary hover:underline',
          onClick: () => {
            selectLogisticsOrder(row.original);
          }
        },
        row.original.orderNumber
      )
  },
  {
    accessorKey: 'status',
    header: t('logistics.columns.status'),
    cell: (context) => h(Badge, { variant: 'warning' }, () => context.getValue<string>())
  },
  {
    id: 'freight',
    header: t('logistics.columns.freight'),
    cell: ({ row }) => `${row.original.currency} ${row.original.freightAmount}`
  },
  {
    accessorKey: 'placedAt',
    header: t('logistics.columns.placedAt'),
    cell: (context) => formatLogisticsDateTime(context.getValue<string | null>())
  }
]);

const workspaces = computed<{ id: Workspace; label: string }[]>(() => [
  { id: 'quote', label: t('logistics.workspaces.quote') },
  { id: 'orders', label: t('logistics.workspaces.orders') },
  { id: 'addresses', label: t('logistics.workspaces.addresses') },
  { id: 'draft', label: t('logistics.workspaces.draft') }
]);
</script>

<template>
  <PageHeader :title="t('logistics.title')" :description="t('logistics.description')" />
  <Card class="mb-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-amber-900">
    <ShieldAlert class="mt-0.5 size-4 shrink-0" />
    <div class="text-sm leading-5">
      <p>{{ t('logistics.qualification') }}</p>
      <p class="mt-1 text-xs">
        {{ t('logistics.availability', { reason: logisticsRestrictionReason }) }}
      </p>
    </div>
  </Card>

  <div class="mb-4 flex flex-wrap gap-2" :aria-label="t('logistics.workspaceLabel')">
    <Button
      v-for="item in workspaces"
      :key="item.id"
      size="sm"
      :variant="workspace === item.id ? 'default' : 'outline'"
      @click="workspace = item.id"
    >
      {{ item.label }}
    </Button>
  </div>

  <template v-if="workspace === 'quote'">
    <div class="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <Card class="p-5">
        <div class="mb-4 flex items-center gap-2">
          <Calculator class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('logistics.quote.parcel') }}</h2>
        </div>
        <div class="grid gap-3 md:grid-cols-3">
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.originZip') }}</span
            ><Input v-model="originZipCode"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.destinationCountry') }}</span
            ><Input v-model="destinationCountryCode" maxlength="2"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.destinationZip') }}</span
            ><Input v-model="destinationZipCode"
          /></label>
          <label class="space-y-1 text-sm md:col-span-2">
            <span>{{ t('logistics.quote.product') }}</span>
            <select v-model="productCode" class="h-9 w-full rounded-md border bg-background px-3 text-sm">
              <option
                v-for="product in logisticsProducts.data.value ?? []"
                :key="product.code"
                :value="product.code"
              >
                {{ product.name }} · {{ product.code }}
              </option>
              <option v-if="!(logisticsProducts.data.value?.length ?? 0)" :value="productCode">
                {{ productCode }}
              </option>
            </select>
          </label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.warehouse') }}</span
            ><Input v-model="warehouseCode"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.nameCn') }}</span
            ><Input v-model="cargoNameCn"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.nameEn') }}</span
            ><Input v-model="cargoNameEn"
          /></label>
          <label class="space-y-1 text-sm"><span>HS Code</span><Input v-model="cargoHsCode" /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.quantity') }}</span
            ><Input v-model="cargoQuantity" inputmode="decimal"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.unitValue') }}</span
            ><Input v-model="cargoValue" inputmode="decimal"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.material') }}</span
            ><Input v-model="cargoMaterial"
          /></label>
          <label class="space-y-1 text-sm md:col-span-3">
            <span>{{ t('logistics.quote.specialType') }}</span>
            <select
              v-model="selectedProductType"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">{{ t('logistics.quote.normal') }}</option>
              <option
                v-for="item in specialProductTypes.data.value ?? []"
                :key="item.code"
                :value="item.code"
              >
                {{ item.name }} · {{ item.code }}
              </option>
              <option v-if="!(specialProductTypes.data.value?.length ?? 0)" value="battery">
                {{ t('logistics.quote.battery') }}
              </option>
            </select>
          </label>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-4">
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.length') }}</span
            ><Input v-model="packageLength"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.width') }}</span
            ><Input v-model="packageWidth"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.height') }}</span
            ><Input v-model="packageHeight"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('logistics.quote.weight') }}</span
            ><Input v-model="packageWeight"
          /></label>
        </div>
        <ActionTooltip :disabled="Boolean(quoteDisabledReason)" :reason="quoteDisabledReason">
          <Button class="mt-5" :disabled="Boolean(quoteDisabledReason)" @click="calculateQuote.mutate()">
            <Calculator class="size-4" />{{
              quoteBlocked ? t('logistics.quote.qualificationPending') : t('logistics.quote.start')
            }}
          </Button>
        </ActionTooltip>
        <ErrorNotice
          v-if="calculateQuote.error.value"
          class="mt-3"
          :error="calculateQuote.error.value"
          compact
        />
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">{{ t('logistics.quote.options') }}</h2>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('logistics.quote.consistency') }}</p>
        <div v-if="selectedQuote" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p class="text-sm font-medium">{{ selectedQuote.productName }}</p>
          <p class="mt-2 text-2xl font-semibold">
            {{ selectedQuote.currency }} {{ selectedQuote.totalAmount }}
          </p>
          <p class="mt-2 font-mono text-xs">{{ selectedQuote.productCode }}</p>
          <Badge variant="success" class="mt-3">{{ t('logistics.quote.available') }}</Badge>
        </div>
        <p v-else class="mt-4 text-sm text-muted-foreground">{{ t('logistics.quote.prompt') }}</p>
        <ul
          v-if="calculateQuote.data.value?.issues.length"
          class="mt-4 list-disc pl-5 text-sm text-amber-700"
        >
          <li v-for="issue in calculateQuote.data.value.issues" :key="issue">{{ issue }}</li>
        </ul>
      </Card>
    </div>
  </template>

  <template v-else-if="workspace === 'orders'">
    <Card class="mb-4 p-4">
      <div class="grid gap-3 md:grid-cols-[1fr_auto]">
        <Input v-model="orderNumberFilter" :placeholder="t('logistics.orders.filter')" />
        <ActionTooltip :disabled="Boolean(ordersDisabledReason)" :reason="ordersDisabledReason">
          <Button variant="outline" :disabled="Boolean(ordersDisabledReason)" @click="orders.refetch()">
            <RefreshCw :class="['size-4', orders.isFetching.value ? 'animate-spin' : '']" />{{
              t('common.actions.refresh')
            }}
          </Button>
        </ActionTooltip>
      </div>
    </Card>
    <QueryState
      :loading="orders.isPending.value && !ordersBlocked"
      :error="orders.error.value"
      :retryable="!ordersBlocked"
      @retry="orders.refetch()"
    >
      <DataTable
        :columns="columns"
        :data="orders.data.value?.items ?? []"
        v-model:page="logisticsOrderPage"
        v-model:page-size="logisticsOrderPageSize"
        :total-rows="orders.data.value?.total ?? 0"
        :pagination-disabled="orders.isFetching.value"
        :empty-text="t('logistics.orders.empty')"
        min-width="720px"
        :get-row-key="(order) => order.orderNumber"
        :active-row-key="logisticsOrderSheetOpen ? selectedOrderNumber : undefined"
        :row-aria-label="(order) => t('logistics.orders.view', { number: order.orderNumber })"
        @row-activate="selectLogisticsOrder"
      >
        <template #empty>
          <div class="space-y-3 py-4">
            <p>
              {{ orderNumberFilter ? t('logistics.orders.noMatch') : t('logistics.orders.noOrders') }}
            </p>
            <Button v-if="orderNumberFilter" variant="outline" size="sm" @click="orderNumberFilter = ''">{{
              t('logistics.orders.clear')
            }}</Button>
            <Button v-else variant="outline" size="sm" @click="orders.refetch()">
              {{ t('common.actions.retry') }}
            </Button>
          </div>
        </template>
      </DataTable>
    </QueryState>
    <Sheet
      :open="logisticsOrderSheetOpen"
      :title="
        selectedOrderNumber
          ? t('logistics.orders.title', { number: selectedOrderNumber })
          : t('logistics.orders.fallbackTitle')
      "
      :description="t('logistics.orders.description')"
      @update:open="logisticsOrderSheetOpen = $event"
    >
      <template #toolbar>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Badge v-if="selectedLogisticsOrder" variant="outline">{{ selectedLogisticsOrder.status }}</Badge>
          <span v-if="selectedLogisticsOrder" class="text-sm font-medium">
            {{ selectedLogisticsOrder.currency }} {{ selectedLogisticsOrder.freightAmount }}
          </span>
        </div>
      </template>
      <QueryState
        :loading="orderDetail.isPending.value"
        :error="orderDetail.error.value"
        retryable
        @retry="orderDetail.refetch()"
      >
        <Card v-if="orderDetail.data.value" class="p-5">
          <div>
            <p class="font-semibold">{{ t('logistics.orders.information') }}</p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ orderDetail.data.value.warehouseName ?? t('logistics.orders.warehouseMissing') }} ·
              {{ orderDetail.data.value.trackingNumber ?? t('logistics.orders.trackingMissing') }}
            </p>
          </div>
          <div class="mt-4 rounded-lg border p-4 text-sm">
            <p v-if="orderDetail.data.value.labelUrl">
              <a
                class="text-primary underline"
                :href="orderDetail.data.value.labelUrl"
                target="_blank"
                rel="noreferrer"
                >{{ t('logistics.orders.labelHttps') }}</a
              >
            </p>
            <p v-else-if="orderDetail.data.value.labelBase64">{{ t('logistics.orders.labelBase64') }}</p>
            <p v-else>{{ t('logistics.orders.labelMissing') }}</p>
          </div>
        </Card>
      </QueryState>
    </Sheet>
  </template>

  <template v-else-if="workspace === 'addresses'">
    <div class="grid gap-4 xl:grid-cols-2">
      <Card class="p-5">
        <div class="mb-4 flex items-center gap-2">
          <MapPin class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('logistics.addresses.dictionary') }}</h2>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1 text-sm">
            <span>{{ t('logistics.addresses.level') }}</span>
            <select v-model="addressLevel" class="h-9 w-full rounded-md border bg-background px-3 text-sm">
              <option value="province">{{ t('logistics.addresses.province') }}</option>
              <option value="city">{{ t('logistics.addresses.city') }}</option>
              <option value="division">{{ t('logistics.addresses.division') }}</option>
              <option value="street">{{ t('logistics.addresses.street') }}</option>
            </select>
          </label>
          <label v-if="addressLevel !== 'province' && addressLevel !== 'street'" class="space-y-1 text-sm">
            <span>{{ t('logistics.addresses.parentId') }}</span
            ><Input v-model="addressParentId" />
          </label>
          <label v-else-if="addressLevel === 'street'" class="space-y-1 text-sm">
            <span>{{ t('logistics.addresses.search') }}</span
            ><Input v-model="addressSearchText" />
          </label>
        </div>
        <div class="mt-4 space-y-2">
          <div
            v-for="node in addressNodes.data.value ?? []"
            :key="node.id"
            class="rounded-lg border p-3 text-sm"
          >
            <span class="font-medium">{{ node.name }}</span
            ><code class="ml-2 text-xs text-muted-foreground">{{ node.code }}</code>
          </div>
          <p v-if="addressNodesBlocked" class="text-sm text-muted-foreground">
            {{
              operationAvailabilityMessage(
                logisticsOperations.reasonCode('listLogisticsAddressNodes'),
                t('logistics.errors.addressUnavailable')
              )
            }}
          </p>
        </div>
      </Card>
      <Card class="p-5">
        <div class="mb-4 flex items-center gap-2">
          <Truck class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('logistics.addresses.templates') }}</h2>
        </div>
        <QueryState
          :loading="shippingTemplates.isPending.value"
          :error="shippingTemplates.error.value"
          retryable
          @retry="shippingTemplates.refetch()"
        >
          <div class="space-y-2">
            <div
              v-for="template in shippingTemplates.data.value ?? []"
              :key="template.id"
              class="rounded-lg border p-3 text-sm"
            >
              <p class="font-medium">{{ template.name }}</p>
              <code class="text-xs text-muted-foreground">{{ template.id }}</code>
            </div>
          </div>
        </QueryState>
      </Card>
    </div>
  </template>

  <template v-else>
    <div class="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
      <Card class="p-5">
        <div class="mb-4 flex items-center gap-2">
          <ClipboardList class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('logistics.draft.contacts') }}</h2>
        </div>
        <p class="mb-4 text-xs text-muted-foreground">
          {{ t('logistics.draft.privacy') }}
        </p>
        <div class="grid gap-4 md:grid-cols-2">
          <fieldset class="space-y-3 rounded-lg border p-4">
            <legend class="px-1 text-sm font-medium">{{ t('logistics.draft.consignor') }}</legend>
            <Input v-model="consignorPerson" :placeholder="t('logistics.draft.contact')" /><Input
              v-model="consignorMobile"
              :placeholder="t('logistics.draft.phone')"
            />
            <textarea
              v-model="consignorAddress"
              class="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
              :placeholder="t('logistics.draft.address')"
            />
          </fieldset>
          <fieldset class="space-y-3 rounded-lg border p-4">
            <legend class="px-1 text-sm font-medium">{{ t('logistics.draft.consignee') }}</legend>
            <Input v-model="consigneePerson" :placeholder="t('logistics.draft.contact')" /><Input
              v-model="consigneeMobile"
              :placeholder="t('logistics.draft.phone')"
            />
            <textarea
              v-model="consigneeAddress"
              class="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
              :placeholder="t('logistics.draft.address')"
            />
          </fieldset>
        </div>
        <ActionTooltip :disabled="Boolean(createOrderDisabledReason)" :reason="createOrderDisabledReason">
          <Button class="mt-5" :disabled="Boolean(createOrderDisabledReason)" @click="createOrder.mutate()">
            <PackageCheck class="size-4" />{{
              createOrderBlocked ? t('logistics.draft.disabled') : t('logistics.draft.submit')
            }}
          </Button>
        </ActionTooltip>
        <p v-if="!selectedQuote" class="mt-2 text-xs text-amber-700">
          {{ t('logistics.draft.quotePrompt') }}
        </p>
        <ErrorNotice v-if="createOrder.error.value" class="mt-3" :error="createOrder.error.value" compact />
      </Card>
      <Card class="p-5">
        <div class="flex items-center gap-2">
          <PackageCheck class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('logistics.draft.result') }}</h2>
        </div>
        <div
          v-if="createOrder.data.value"
          class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4"
        >
          <Badge variant="success">{{ t('logistics.draft.demoSuccess') }}</Badge>
          <p class="mt-3 font-mono text-sm">{{ createOrder.data.value.orderNumber }}</p>
        </div>
        <p v-else class="mt-4 text-sm text-muted-foreground">{{ t('logistics.draft.noPersistence') }}</p>
      </Card>
    </div>
  </template>
</template>
