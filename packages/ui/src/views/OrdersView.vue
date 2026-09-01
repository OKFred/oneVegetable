<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  FileSignature,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Truck
} from '@lucide/vue';
import { toast } from 'vue-sonner';

import type { TradeOrderDraft, TradeOrderSummary } from '@one-vegetable/core';

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
import { appHash, parseAppHash } from '../lib/hash-router';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import type { DataColumn } from '../lib/table';

type Workspace = 'orders' | 'finance' | 'addresses' | 'assurance';
type OrderDrawerTab = 'overview' | 'payment';

const { gateway, mode } = useServices();
const { t } = useUiI18n();
const { alibabaLanguage: preferredLanguage } = useAppPreferences();
const workspace = ref<Workspace>('orders');
const status = ref('');
const buyerLoginId = ref('');
const orderPage = ref(1);
const orderPageSize = ref(20);
const selectedOrderId = ref('');
const serviceCurrency = ref('USD');
const addressCountry = ref('US');
const buyerEmail = ref('');
const draftBuyer = ref('');
const draftCurrency = ref('USD');
const draftProductId = ref('');
const draftSubject = ref('');
const draftQuantity = ref('1');
const draftUnitPrice = ref('');
const orderSheetOpen = ref(false);
const orderDrawerTab = ref<OrderDrawerTab>('overview');
const ttAccountRevealed = ref(false);
const tradeOrderMutation = useOperationAvailability(['createTradeOrder']);
const mutationBlocked = computed(() => !tradeOrderMutation.isAllowed('createTradeOrder'));
const mutationDisabledReason = computed(() =>
  operationAvailabilityMessage(
    tradeOrderMutation.reasonCode('createTradeOrder'),
    t('orders.errors.createUnavailable')
  )
);

const orders = useQuery({
  queryKey: computed(() => [
    'trade-orders',
    status.value,
    buyerLoginId.value,
    orderPage.value,
    orderPageSize.value
  ]),
  queryFn: () =>
    gateway.request('listTradeOrders', {
      page: orderPage.value,
      pageSize: orderPageSize.value,
      ...(status.value ? { status: status.value } : {}),
      ...(buyerLoginId.value ? { buyerLoginId: buyerLoginId.value } : {})
    })
});
const selectedOrder = computed(() =>
  (orders.data.value?.items ?? []).find((order) => order.id === selectedOrderId.value)
);
const selectedOrderIndex = computed(() =>
  (orders.data.value?.items ?? []).findIndex((order) => order.id === selectedOrderId.value)
);
const hasPreviousOrder = computed(() => selectedOrderIndex.value > 0);
const hasNextOrder = computed(() => {
  const items = orders.data.value?.items ?? [];
  return selectedOrderIndex.value >= 0 && selectedOrderIndex.value < items.length - 1;
});
const aggregate = useQuery({
  queryKey: computed(() => ['trade-order-aggregate', selectedOrderId.value]),
  enabled: computed(() => orderSheetOpen.value && selectedOrder.value !== undefined),
  queryFn: () => {
    const order = selectedOrder.value;
    if (!order) throw new Error(t('orders.errors.selectOrder'));
    return gateway.request('getTradeOrderAggregate', { order });
  }
});
const fulfillmentChannels = useQuery({
  queryKey: computed(() => ['trade-fulfillment-channels', preferredLanguage.value]),
  enabled: computed(() => workspace.value === 'finance'),
  queryFn: () => gateway.request('listTradeFulfillmentChannels', { language: preferredLanguage.value })
});
const serviceCharge = useQuery({
  queryKey: computed(() => ['trade-service-charge', serviceCurrency.value]),
  enabled: computed(() => workspace.value === 'finance'),
  queryFn: () => gateway.request('getTradeServiceCharge', { currency: serviceCurrency.value })
});
const ttAccount = useQuery({
  queryKey: computed(() => ['trade-tt-account', selectedOrderId.value]),
  enabled: computed(
    () => orderSheetOpen.value && orderDrawerTab.value === 'payment' && selectedOrderId.value !== ''
  ),
  queryFn: () => gateway.request('getTradeTtAccount', { orderId: selectedOrderId.value })
});
const addressSchema = useQuery({
  queryKey: computed(() => ['trade-address-schema', addressCountry.value, preferredLanguage.value]),
  enabled: computed(() => workspace.value === 'addresses' && addressCountry.value.trim() !== ''),
  queryFn: () =>
    gateway.request('getTradeAddressSchema', {
      countryCode: addressCountry.value.trim().toUpperCase(),
      language: preferredLanguage.value
    })
});
const addresses = useQuery({
  queryKey: computed(() => ['trade-addresses', buyerEmail.value]),
  enabled: computed(() => workspace.value === 'addresses' && buyerEmail.value.includes('@')),
  queryFn: () => gateway.request('listTradeAddresses', { buyerEmail: buyerEmail.value.trim() })
});

const draftComplete = computed(
  () =>
    draftBuyer.value.trim() !== '' &&
    draftProductId.value.trim() !== '' &&
    draftSubject.value.trim() !== '' &&
    /^\d+(?:\.\d+)?$/.test(draftQuantity.value) &&
    /^\d+(?:\.\d+)?$/.test(draftUnitPrice.value)
);
const createOrderDisabledReason = computed(() => {
  if (mutationBlocked.value) return mutationDisabledReason.value;
  if (createOrder.isPending.value) return t('orders.errors.creating');
  if (!draftComplete.value) return t('orders.errors.incompleteDraft');
  return '';
});
const createOrder = useMutation({
  mutationFn: () => gateway.request('createTradeOrder', orderDraft()),
  onSuccess: (result) => toast.success(t('orders.feedback.created', { id: result.id }))
});

function orderDraft(): TradeOrderDraft {
  return {
    buyerLoginId: draftBuyer.value.trim(),
    currency: draftCurrency.value.trim().toUpperCase(),
    items: [
      {
        productId: draftProductId.value.trim(),
        subject: draftSubject.value.trim(),
        quantity: draftQuantity.value,
        unitPrice: draftUnitPrice.value
      }
    ]
  };
}

function selectOrder(order: TradeOrderSummary): void {
  selectedOrderId.value = order.id;
  orderDrawerTab.value = 'overview';
  ttAccountRevealed.value = false;
  orderSheetOpen.value = true;
  updateOrdersHash();
}

function setOrderSheetOpen(open: boolean): void {
  orderSheetOpen.value = open;
  if (!open) {
    selectedOrderId.value = '';
    orderDrawerTab.value = 'overview';
    ttAccountRevealed.value = false;
  }
  updateOrdersHash();
}

function setWorkspace(nextWorkspace: Workspace): void {
  workspace.value = nextWorkspace;
  orderSheetOpen.value = false;
  selectedOrderId.value = '';
  orderDrawerTab.value = 'overview';
  ttAccountRevealed.value = false;
  updateOrdersHash();
}

function setOrderDrawerTab(tab: OrderDrawerTab): void {
  orderDrawerTab.value = tab;
  ttAccountRevealed.value = false;
  updateOrdersHash();
}

function moveOrder(offset: -1 | 1): void {
  const next = (orders.data.value?.items ?? [])[selectedOrderIndex.value + offset];
  if (next) selectOrder(next);
}

function maskedAccountNumber(value: string | null): string {
  if (!value) return t('orders.notReturned');
  if (ttAccountRevealed.value) return value;
  const visible = value.slice(-4);
  return `${'•'.repeat(Math.max(4, value.length - visible.length))}${visible}`;
}

function formatOrderDateTime(value: string | null): string {
  return formatDateTime(value, t('orders.documentNotReturned'));
}

const columns = computed<DataColumn<TradeOrderSummary>[]>(() => [
  {
    accessorKey: 'id',
    header: t('orders.columns.orderId'),
    cell: ({ row }) =>
      h(
        'button',
        {
          class: 'font-mono text-xs text-primary hover:underline',
          onClick: () => {
            selectOrder(row.original);
          }
        },
        row.original.id
      )
  },
  { accessorKey: 'buyerLoginId', header: t('orders.columns.buyer') },
  {
    id: 'amount',
    header: t('orders.columns.amount'),
    cell: ({ row }) => `${row.original.currency} ${row.original.amount}`
  },
  {
    accessorKey: 'status',
    header: t('orders.columns.status'),
    cell: (context) => h(Badge, { variant: 'warning' }, () => context.getValue<string>())
  },
  {
    accessorKey: 'modifiedAt',
    header: t('orders.columns.modifiedAt'),
    cell: (context) => formatOrderDateTime(context.getValue<string | null>())
  },
  {
    id: 'actions',
    header: t('orders.columns.actions'),
    cell: ({ row }) =>
      h(
        Button,
        {
          size: 'sm',
          variant: 'outline',
          onClick: () => {
            selectOrder(row.original);
          }
        },
        () => t('orders.view')
      )
  }
]);

const workspaces = computed<{ id: Workspace; label: string }[]>(() => [
  { id: 'orders', label: t('orders.workspaces.orders') },
  { id: 'finance', label: t('orders.workspaces.finance') },
  { id: 'addresses', label: t('orders.workspaces.addresses') },
  { id: 'assurance', label: t('orders.workspaces.assurance') }
]);
const workspaceIds = new Set<Workspace>(['orders', 'finance', 'addresses', 'assurance']);

function updateOrdersHash(): void {
  const segments: string[] = [workspace.value];
  if (workspace.value === 'orders' && orderSheetOpen.value && selectedOrderId.value) {
    segments.push(selectedOrderId.value, orderDrawerTab.value);
  }
  const nextHash = appHash('orders', ...segments);
  if (globalThis.location.hash !== nextHash) globalThis.history.pushState(null, '', nextHash);
}

function syncOrdersFromHash(): void {
  const route = parseAppHash(globalThis.location.hash);
  if (route?.page !== 'orders') return;
  const requestedWorkspace = route.segments[0];
  workspace.value =
    requestedWorkspace && workspaceIds.has(requestedWorkspace as Workspace)
      ? (requestedWorkspace as Workspace)
      : 'orders';
  const requestedOrderId = route.segments[1] ?? '';
  if (workspace.value === 'orders' && requestedOrderId) {
    selectedOrderId.value = requestedOrderId;
    orderDrawerTab.value = route.segments[2] === 'payment' ? 'payment' : 'overview';
    orderSheetOpen.value = true;
  } else {
    selectedOrderId.value = '';
    orderDrawerTab.value = 'overview';
    orderSheetOpen.value = false;
  }
  ttAccountRevealed.value = false;
}

watch(selectedOrderId, () => {
  ttAccountRevealed.value = false;
});

watch([status, buyerLoginId], () => {
  orderPage.value = 1;
});

watch([orderPage, orderPageSize], () => {
  setOrderSheetOpen(false);
});

onMounted(() => {
  globalThis.addEventListener('hashchange', syncOrdersFromHash);
  globalThis.addEventListener('popstate', syncOrdersFromHash);
  syncOrdersFromHash();
});

onBeforeUnmount(() => {
  globalThis.removeEventListener('hashchange', syncOrdersFromHash);
  globalThis.removeEventListener('popstate', syncOrdersFromHash);
});
</script>

<template>
  <PageHeader :title="t('orders.title')" :description="t('orders.description')" />
  <Card class="mb-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-amber-900">
    <ShieldAlert class="mt-0.5 size-4 shrink-0" />
    <p class="text-sm leading-5">
      {{ t('orders.jushitaNotice') }}
    </p>
  </Card>

  <div class="mb-4 flex flex-wrap gap-2" :aria-label="t('orders.workspaceLabel')">
    <Button
      v-for="item in workspaces"
      :key="item.id"
      size="sm"
      :variant="workspace === item.id ? 'default' : 'outline'"
      @click="setWorkspace(item.id)"
    >
      {{ item.label }}
    </Button>
  </div>

  <template v-if="workspace === 'orders'">
    <Card class="mb-4 p-4">
      <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <Input v-model="buyerLoginId" :placeholder="t('orders.filters.buyer')" />
        <select v-model="status" class="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">{{ t('orders.filters.allStatuses') }}</option>
          <option value="unpay">{{ t('orders.filters.unpay') }}</option>
          <option value="paid">{{ t('orders.filters.paid') }}</option>
          <option value="undeliver">{{ t('orders.filters.undeliver') }}</option>
          <option value="delivering">{{ t('orders.filters.delivering') }}</option>
          <option value="trade_success">{{ t('orders.filters.success') }}</option>
          <option value="trade_close">{{ t('orders.filters.closed') }}</option>
        </select>
        <Button variant="outline" :disabled="orders.isFetching.value" @click="orders.refetch()">
          <RefreshCw class="size-4" />{{ t('common.actions.refresh') }}
        </Button>
      </div>
      <p v-if="orders.data.value?.documentTimeZoneUnverified" class="mt-3 text-xs text-amber-700">
        {{ t('orders.filters.timeZoneWarning') }}
      </p>
    </Card>
    <QueryState
      :loading="orders.isPending.value"
      :error="orders.error.value"
      retryable
      @retry="orders.refetch()"
    >
      <DataTable
        :columns="columns"
        :data="orders.data.value?.items ?? []"
        v-model:page="orderPage"
        v-model:page-size="orderPageSize"
        :total-rows="orders.data.value?.total ?? 0"
        :pagination-disabled="orders.isFetching.value"
        :empty-text="t('orders.noMatch')"
        min-width="900px"
        :get-row-key="(order) => order.id"
        :active-row-key="orderSheetOpen ? selectedOrderId : undefined"
        :row-aria-label="(order) => t('orders.viewOrder', { id: order.id })"
        @row-activate="selectOrder"
      >
        <template #empty>
          <div class="space-y-3 py-4">
            <p>{{ status || buyerLoginId ? t('orders.noMatchingOrder') : t('orders.noOrders') }}</p>
            <Button
              v-if="status || buyerLoginId"
              variant="outline"
              size="sm"
              @click="
                status = '';
                buyerLoginId = '';
              "
              >{{ t('orders.clearFilters') }}</Button
            >
            <Button v-else variant="outline" size="sm" @click="orders.refetch()">
              {{ t('common.actions.retry') }}
            </Button>
          </div>
        </template>
      </DataTable>
    </QueryState>
  </template>

  <template v-else-if="workspace === 'finance'">
    <div class="grid gap-4 xl:grid-cols-2">
      <Card class="p-5">
        <h2 class="font-semibold">{{ t('orders.finance.channels') }}</h2>
        <QueryState
          :loading="fulfillmentChannels.isPending.value"
          :error="fulfillmentChannels.error.value"
          retryable
          @retry="fulfillmentChannels.refetch()"
        >
          <div class="mt-3 space-y-2">
            <div
              v-for="channel in fulfillmentChannels.data.value ?? []"
              :key="channel.code"
              class="flex items-center justify-between rounded-lg border p-3 text-sm"
            >
              <div>
                <p class="font-medium">{{ channel.name }} · {{ channel.code }}</p>
                <p v-if="channel.unavailableReason" class="mt-1 text-xs text-muted-foreground">
                  {{ channel.unavailableReason }}
                </p>
              </div>
              <Badge :variant="channel.enabled ? 'success' : 'warning'">
                {{ channel.enabled ? t('orders.finance.available') : t('orders.finance.unavailable') }}
              </Badge>
            </div>
          </div>
        </QueryState>
      </Card>
      <Card class="p-5">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold">{{ t('orders.finance.serviceCharge') }}</h2>
          <Input v-model="serviceCurrency" class="w-24" :aria-label="t('orders.finance.currencyLabel')" />
        </div>
        <QueryState
          :loading="serviceCharge.isPending.value"
          :error="serviceCharge.error.value"
          retryable
          @retry="serviceCharge.refetch()"
        >
          <div
            v-for="(item, index) in serviceCharge.data.value?.items ?? []"
            :key="index"
            class="mt-3 rounded-lg border p-3 text-sm"
          >
            <p>
              {{
                t('orders.finance.rateAndCap', {
                  rate: item.ratio ?? t('orders.finance.notReturned'),
                  cap: item.maxFee ?? t('orders.finance.notReturned')
                })
              }}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ item.exportServiceType ?? t('orders.finance.serviceTypeMissing') }} ·
              {{ item.logisticsType ?? t('orders.finance.logisticsTypeMissing') }}
            </p>
          </div>
        </QueryState>
      </Card>
    </div>
  </template>

  <template v-else-if="workspace === 'addresses'">
    <Card class="mb-4 p-5">
      <div class="grid gap-3 md:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span>{{ t('orders.addresses.country') }}</span>
          <Input v-model="addressCountry" maxlength="2" placeholder="US" />
        </label>
        <label class="space-y-1 text-sm">
          <span>{{ t('orders.addresses.buyerEmail') }}</span>
          <Input v-model="buyerEmail" type="email" placeholder="buyer@example.com" />
        </label>
      </div>
      <p class="mt-3 text-xs text-muted-foreground">{{ t('orders.addresses.privacy') }}</p>
    </Card>
    <div class="grid gap-4 xl:grid-cols-2">
      <Card class="p-5">
        <h2 class="font-semibold">{{ t('orders.addresses.schema') }}</h2>
        <QueryState
          :loading="addressSchema.isPending.value"
          :error="addressSchema.error.value"
          retryable
          @retry="addressSchema.refetch()"
        >
          <div class="mt-3 space-y-2">
            <div
              v-for="field in addressSchema.data.value?.fields ?? []"
              :key="field.id"
              class="rounded-lg border p-3"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">{{ field.label }}</span>
                <Badge v-if="field.required" variant="warning">{{ t('orders.addresses.required') }}</Badge>
                <Badge variant="outline">{{ field.type }}</Badge>
              </div>
              <code class="mt-1 block text-xs text-muted-foreground">{{ field.id }}</code>
            </div>
          </div>
        </QueryState>
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">{{ t('orders.addresses.addressBook') }}</h2>
        <p v-if="!buyerEmail.includes('@')" class="mt-3 text-sm text-muted-foreground">
          {{ t('orders.addresses.emailPrompt') }}
        </p>
        <QueryState
          v-else
          :loading="addresses.isPending.value"
          :error="addresses.error.value"
          retryable
          @retry="addresses.refetch()"
        >
          <div
            v-for="address in addresses.data.value ?? []"
            :key="address.id"
            class="mt-3 rounded-lg border p-3 text-sm"
          >
            <div class="flex items-center gap-2">
              <MapPin class="size-4 text-primary" />
              <p class="font-medium">{{ address.label }}</p>
            </div>
            <code class="mt-2 block text-xs text-muted-foreground">{{ address.id }}</code>
          </div>
        </QueryState>
        <ActionTooltip :disabled="true" :reason="t('orders.addresses.writeUnavailable')">
          <Button class="mt-4" variant="outline" disabled>{{ t('orders.addresses.add') }}</Button>
        </ActionTooltip>
      </Card>
    </div>
  </template>

  <template v-else>
    <Card class="p-5">
      <div class="flex items-start gap-3">
        <FileSignature class="mt-0.5 size-5 text-primary" />
        <div>
          <h2 class="font-semibold">{{ t('orders.assurance.title') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ t('orders.assurance.description') }}
          </p>
        </div>
      </div>
      <div class="mt-5 grid gap-3 md:grid-cols-2">
        <Input v-model="draftBuyer" :placeholder="t('orders.assurance.buyer')" />
        <Input v-model="draftCurrency" :placeholder="t('orders.assurance.currency')" />
        <Input v-model="draftProductId" :placeholder="t('orders.assurance.productId')" />
        <Input v-model="draftSubject" :placeholder="t('orders.assurance.subject')" />
        <Input v-model="draftQuantity" inputmode="decimal" :placeholder="t('orders.assurance.quantity')" />
        <Input v-model="draftUnitPrice" inputmode="decimal" :placeholder="t('orders.assurance.unitPrice')" />
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <ActionTooltip :disabled="Boolean(createOrderDisabledReason)" :reason="createOrderDisabledReason">
          <Button :disabled="Boolean(createOrderDisabledReason)" @click="createOrder.mutate()">
            {{ mode === 'mock' ? t('orders.assurance.createDemo') : t('orders.assurance.createUnavailable') }}
          </Button>
        </ActionTooltip>
        <Badge v-if="mutationBlocked" variant="warning">{{ mutationDisabledReason }}</Badge>
        <Badge v-else variant="success">{{ t('orders.assurance.webDemo') }}</Badge>
      </div>
      <p v-if="createOrder.data.value" class="mt-3 text-sm text-emerald-700">
        {{ t('orders.assurance.demoCreated', { id: createOrder.data.value.id }) }}
      </p>
      <ErrorNotice v-if="createOrder.error.value" class="mt-3" :error="createOrder.error.value" compact />
    </Card>
  </template>

  <Sheet
    :open="orderSheetOpen"
    :title="
      selectedOrder ? t('orders.drawer.title', { id: selectedOrder.id }) : t('orders.drawer.fallbackTitle')
    "
    :description="t('orders.drawer.description')"
    @update:open="setOrderSheetOpen"
  >
    <template #toolbar>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Badge v-if="selectedOrder" variant="warning">{{ selectedOrder.status }}</Badge>
          <Badge variant="outline">fullDetail: jushita-only</Badge>
        </div>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            :disabled="!hasPreviousOrder"
            :aria-label="t('orders.drawer.previousLabel')"
            @click="moveOrder(-1)"
          >
            <ChevronLeft class="size-4" />{{ t('orders.drawer.previous') }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="!hasNextOrder"
            :aria-label="t('orders.drawer.nextLabel')"
            @click="moveOrder(1)"
          >
            {{ t('orders.drawer.next') }}<ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </template>

    <template v-if="selectedOrder">
      <div class="mb-5 flex gap-2" role="tablist" :aria-label="t('orders.drawer.tabsLabel')">
        <Button
          size="sm"
          :variant="orderDrawerTab === 'overview' ? 'default' : 'outline'"
          role="tab"
          :aria-selected="orderDrawerTab === 'overview'"
          @click="setOrderDrawerTab('overview')"
        >
          {{ t('orders.drawer.overview') }}
        </Button>
        <Button
          size="sm"
          :variant="orderDrawerTab === 'payment' ? 'default' : 'outline'"
          role="tab"
          :aria-selected="orderDrawerTab === 'payment'"
          @click="setOrderDrawerTab('payment')"
        >
          {{ t('orders.drawer.payment') }}
        </Button>
      </div>

      <section
        v-if="orderDrawerTab === 'overview'"
        class="space-y-4"
        :aria-label="t('orders.drawer.overviewLabel')"
      >
        <Card class="p-4">
          <div class="flex items-start gap-3">
            <ClipboardList class="mt-0.5 size-5 text-primary" />
            <div class="grid flex-1 gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs text-muted-foreground">{{ t('orders.drawer.orderAmount') }}</p>
                <p class="mt-1 text-lg font-semibold">
                  {{ selectedOrder.currency }} {{ selectedOrder.amount }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">{{ t('orders.drawer.buyer') }}</p>
                <p class="mt-1 font-medium">{{ selectedOrder.buyerLoginId ?? t('orders.notReturned') }}</p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">{{ t('orders.drawer.createdAt') }}</p>
                <p class="mt-1 text-sm">{{ formatOrderDateTime(selectedOrder.createdAt) }}</p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">{{ t('orders.drawer.modifiedAt') }}</p>
                <p class="mt-1 text-sm">{{ formatOrderDateTime(selectedOrder.modifiedAt) }}</p>
              </div>
            </div>
          </div>
        </Card>

        <QueryState
          :loading="aggregate.isPending.value"
          :error="aggregate.error.value"
          retryable
          @retry="aggregate.refetch()"
        >
          <div class="grid gap-4 sm:grid-cols-2">
            <Card class="p-4">
              <Banknote class="mb-2 size-5 text-primary" />
              <p class="text-xs text-muted-foreground">{{ t('orders.drawer.funds') }}</p>
              <template v-if="aggregate.data.value?.fund">
                <p class="mt-1 font-semibold">
                  {{ aggregate.data.value.fund.currency }} {{ aggregate.data.value.fund.paidAmount }}
                </p>
                <p class="mt-1 text-sm">{{ aggregate.data.value.fund.status }}</p>
              </template>
              <Badge v-else variant="warning" class="mt-2">{{ t('orders.drawer.apiUnavailable') }}</Badge>
            </Card>
            <Card class="p-4">
              <Truck class="mb-2 size-5 text-primary" />
              <p class="text-xs text-muted-foreground">{{ t('orders.drawer.logistics') }}</p>
              <template v-if="aggregate.data.value?.logistics">
                <p class="mt-1 font-semibold">{{ aggregate.data.value.logistics.status }}</p>
                <p class="mt-1 text-sm">
                  {{ aggregate.data.value.logistics.carrier ?? t('orders.drawer.carrierMissing') }}
                </p>
                <code class="mt-1 block text-xs text-muted-foreground">
                  {{ aggregate.data.value.logistics.trackingNumber ?? t('orders.drawer.trackingMissing') }}
                </code>
              </template>
              <Badge v-else variant="warning" class="mt-2">{{ t('orders.drawer.apiUnavailable') }}</Badge>
            </Card>
          </div>
        </QueryState>

        <Card class="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p class="font-medium">{{ t('orders.drawer.fullDetailUnavailable') }}</p>
          <p class="mt-1 leading-6">
            {{ t('orders.drawer.fullDetailReason') }}
          </p>
        </Card>
      </section>

      <section v-else :aria-label="t('orders.drawer.paymentLabel')">
        <QueryState
          :loading="ttAccount.isPending.value"
          :error="ttAccount.error.value"
          retryable
          @retry="ttAccount.refetch()"
        >
          <Card v-if="ttAccount.data.value" class="space-y-4 p-5">
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <p class="text-xs text-muted-foreground">{{ t('orders.drawer.payable') }}</p>
                <p class="mt-1 text-lg font-semibold">
                  {{ ttAccount.data.value.currency }} {{ ttAccount.data.value.payableAmount }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">{{ t('orders.drawer.recipient') }}</p>
                <p class="mt-1 font-medium">
                  {{ ttAccount.data.value.accountName ?? t('orders.notReturned') }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">{{ t('orders.drawer.bank') }}</p>
                <p class="mt-1 font-medium">{{ ttAccount.data.value.bankName ?? t('orders.notReturned') }}</p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">{{ t('orders.drawer.account') }}</p>
                <div class="mt-1 flex items-center gap-2">
                  <code data-testid="tt-account-number">
                    {{ maskedAccountNumber(ttAccount.data.value.accountNumber) }}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    :disabled="!ttAccount.data.value.accountNumber"
                    :aria-label="
                      ttAccountRevealed ? t('orders.drawer.hideAccount') : t('orders.drawer.showAccount')
                    "
                    @click="ttAccountRevealed = !ttAccountRevealed"
                  >
                    <EyeOff v-if="ttAccountRevealed" class="size-4" />
                    <Eye v-else class="size-4" />
                  </Button>
                </div>
              </div>
            </div>
            <p v-if="ttAccount.data.value.guideContent" class="rounded-md bg-muted p-3 text-sm leading-6">
              {{ ttAccount.data.value.guideContent }}
            </p>
          </Card>
        </QueryState>
        <p class="mt-4 text-xs leading-5 text-muted-foreground">
          {{ t('orders.drawer.sensitiveNotice') }}
        </p>
      </section>
    </template>
  </Sheet>
</template>
