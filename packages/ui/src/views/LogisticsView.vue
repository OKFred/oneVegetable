<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { Calculator, ClipboardList, MapPin, PackageCheck, RefreshCw, ShieldAlert, Truck } from '@lucide/vue';

import type { LogisticsOrderSummary, LogisticsQuoteRequest } from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import Sheet from '../components/ui/Sheet.vue';
import {
  operationAvailabilityMessage,
  useOperationAvailability
} from '../composables/use-operation-availability';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

type Workspace = 'quote' | 'orders' | 'addresses' | 'draft';

const { gateway } = useServices();
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
    '当前环境未开放 OneTouch 国际物流试算'
  )
);
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
  mutationFn: () => gateway.request('calculateLogisticsQuote', buildQuoteRequest())
});
const selectedQuote = computed(() => calculateQuote.data.value?.options.find((option) => option.available));
const createOrder = useMutation({
  mutationFn: () => {
    const quote = selectedQuote.value;
    if (!quote) throw new Error('请先完成运费试算并选择可用方案');
    return gateway.request('createLogisticsOrder', {
      quoteRequest: buildQuoteRequest(),
      confirmedProductCode: quote.productCode
    });
  }
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

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '文档未返回';
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

const columns: DataColumn<LogisticsOrderSummary>[] = [
  {
    accessorKey: 'orderNumber',
    header: '物流订单号',
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
    header: '状态',
    cell: (context) => h(Badge, { variant: 'warning' }, () => context.getValue<string>())
  },
  {
    id: 'freight',
    header: '运费',
    cell: ({ row }) => `${row.original.currency} ${row.original.freightAmount}`
  },
  {
    accessorKey: 'placedAt',
    header: '下单时间',
    cell: (context) => formatDate(context.getValue<string | null>())
  }
];

const workspaces: { id: Workspace; label: string }[] = [
  { id: 'quote', label: '运费试算' },
  { id: 'orders', label: '物流订单' },
  { id: 'addresses', label: '地址与模板' },
  { id: 'draft', label: '下单草稿' }
];
</script>

<template>
  <PageHeader
    title="国际物流工作台"
    description="地址、商品属性、运力试算、物流订单和面单统一转换为稳定类型；金额和业务 ID 全程按字符串处理。"
  />
  <Card class="mb-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-amber-900">
    <ShieldAlert class="mt-0.5 size-4 shrink-0" />
    <div class="text-sm leading-5">
      <p>OneTouch 国际物流接口需要业务资格，本项目尚无真实账号完成验收。</p>
      <p class="mt-1 text-xs">
        页面按 operation availability 决定是否调用；{{
          logisticsRestrictionReason
        }}。运费模板属于商品域免费接口，可独立查询。
      </p>
    </div>
  </Card>

  <div class="mb-4 flex flex-wrap gap-2" aria-label="物流工作区">
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
          <h2 class="font-semibold">包裹与货品</h2>
        </div>
        <div class="grid gap-3 md:grid-cols-3">
          <label class="space-y-1 text-sm"><span>始发邮编</span><Input v-model="originZipCode" /></label>
          <label class="space-y-1 text-sm"
            ><span>目的国</span><Input v-model="destinationCountryCode" maxlength="2"
          /></label>
          <label class="space-y-1 text-sm"><span>目的邮编</span><Input v-model="destinationZipCode" /></label>
          <label class="space-y-1 text-sm md:col-span-2">
            <span>运力产品</span>
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
          <label class="space-y-1 text-sm"><span>仓库代码</span><Input v-model="warehouseCode" /></label>
          <label class="space-y-1 text-sm"><span>中文品名</span><Input v-model="cargoNameCn" /></label>
          <label class="space-y-1 text-sm"><span>英文品名</span><Input v-model="cargoNameEn" /></label>
          <label class="space-y-1 text-sm"><span>HS Code</span><Input v-model="cargoHsCode" /></label>
          <label class="space-y-1 text-sm"
            ><span>数量</span><Input v-model="cargoQuantity" inputmode="decimal"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>单件申报价值 USD</span><Input v-model="cargoValue" inputmode="decimal"
          /></label>
          <label class="space-y-1 text-sm"><span>材质</span><Input v-model="cargoMaterial" /></label>
          <label class="space-y-1 text-sm md:col-span-3">
            <span>特殊商品属性</span>
            <select
              v-model="selectedProductType"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">普通商品</option>
              <option
                v-for="item in specialProductTypes.data.value ?? []"
                :key="item.code"
                :value="item.code"
              >
                {{ item.name }} · {{ item.code }}
              </option>
              <option v-if="!(specialProductTypes.data.value?.length ?? 0)" value="battery">含电池</option>
            </select>
          </label>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-4">
          <label class="space-y-1 text-sm"><span>长 cm</span><Input v-model="packageLength" /></label>
          <label class="space-y-1 text-sm"><span>宽 cm</span><Input v-model="packageWidth" /></label>
          <label class="space-y-1 text-sm"><span>高 cm</span><Input v-model="packageHeight" /></label>
          <label class="space-y-1 text-sm"><span>重量 kg</span><Input v-model="packageWeight" /></label>
        </div>
        <Button
          class="mt-5"
          :disabled="quoteBlocked || calculateQuote.isPending.value"
          @click="calculateQuote.mutate()"
        >
          <Calculator class="size-4" />{{ quoteBlocked ? '业务资格待验收' : '开始试算' }}
        </Button>
        <ErrorNotice
          v-if="calculateQuote.error.value"
          class="mt-3"
          :error="calculateQuote.error.value"
          compact
        />
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">可用方案</h2>
        <p class="mt-1 text-xs text-muted-foreground">下单时会再次校验产品代码必须与本次试算一致。</p>
        <div v-if="selectedQuote" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p class="text-sm font-medium">{{ selectedQuote.productName }}</p>
          <p class="mt-2 text-2xl font-semibold">
            {{ selectedQuote.currency }} {{ selectedQuote.totalAmount }}
          </p>
          <p class="mt-2 font-mono text-xs">{{ selectedQuote.productCode }}</p>
          <Badge variant="success" class="mt-3">可用</Badge>
        </div>
        <p v-else class="mt-4 text-sm text-muted-foreground">填写参数后执行试算。</p>
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
        <Input v-model="orderNumberFilter" placeholder="按物流订单号过滤" />
        <Button
          variant="outline"
          :disabled="ordersBlocked || orders.isFetching.value"
          @click="orders.refetch()"
        >
          <RefreshCw class="size-4" />刷新
        </Button>
      </div>
    </Card>
    <QueryState :loading="orders.isPending.value && !ordersBlocked" :error="orders.error.value">
      <DataTable
        :columns="columns"
        :data="orders.data.value?.items ?? []"
        v-model:page="logisticsOrderPage"
        v-model:page-size="logisticsOrderPageSize"
        :total-rows="orders.data.value?.total ?? 0"
        :pagination-disabled="orders.isFetching.value"
        empty-text="暂无物流订单"
        min-width="720px"
        :get-row-key="(order) => order.orderNumber"
        :active-row-key="logisticsOrderSheetOpen ? selectedOrderNumber : undefined"
        :row-aria-label="(order) => `查看物流订单 ${order.orderNumber}`"
        @row-activate="selectLogisticsOrder"
      />
    </QueryState>
    <Sheet
      :open="logisticsOrderSheetOpen"
      :title="selectedOrderNumber ? `物流订单 ${selectedOrderNumber}` : '物流订单详情'"
      description="仓库、追踪信息与面单数据"
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
      <QueryState :loading="orderDetail.isPending.value" :error="orderDetail.error.value">
        <Card v-if="orderDetail.data.value" class="p-5">
          <div>
            <p class="font-semibold">订单信息</p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ orderDetail.data.value.warehouseName ?? '仓库未返回' }} ·
              {{ orderDetail.data.value.trackingNumber ?? '追踪号未返回' }}
            </p>
          </div>
          <div class="mt-4 rounded-lg border p-4 text-sm">
            <p v-if="orderDetail.data.value.labelUrl">
              面单：<a
                class="text-primary underline"
                :href="orderDetail.data.value.labelUrl"
                target="_blank"
                rel="noreferrer"
                >HTTPS 地址</a
              >
            </p>
            <p v-else-if="orderDetail.data.value.labelBase64">面单：Base64 数据已返回（不写入持久化存储）</p>
            <p v-else>面单：文档响应未返回</p>
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
          <h2 class="font-semibold">地址字典</h2>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1 text-sm">
            <span>层级</span>
            <select v-model="addressLevel" class="h-9 w-full rounded-md border bg-background px-3 text-sm">
              <option value="province">省</option>
              <option value="city">市</option>
              <option value="division">区县</option>
              <option value="street">街道搜索</option>
            </select>
          </label>
          <label v-if="addressLevel !== 'province' && addressLevel !== 'street'" class="space-y-1 text-sm">
            <span>父级 ID</span><Input v-model="addressParentId" />
          </label>
          <label v-else-if="addressLevel === 'street'" class="space-y-1 text-sm">
            <span>搜索词</span><Input v-model="addressSearchText" />
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
                '当前环境不查询 OneTouch 地址字典'
              )
            }}
          </p>
        </div>
      </Card>
      <Card class="p-5">
        <div class="mb-4 flex items-center gap-2">
          <Truck class="size-4 text-primary" />
          <h2 class="font-semibold">运费模板</h2>
        </div>
        <QueryState :loading="shippingTemplates.isPending.value" :error="shippingTemplates.error.value">
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
          <h2 class="font-semibold">收发件信息</h2>
        </div>
        <p class="mb-4 text-xs text-muted-foreground">
          联系人、电话和地址只保存在当前页面内存；刷新页面即清除。
        </p>
        <div class="grid gap-4 md:grid-cols-2">
          <fieldset class="space-y-3 rounded-lg border p-4">
            <legend class="px-1 text-sm font-medium">发件人</legend>
            <Input v-model="consignorPerson" placeholder="联系人" /><Input
              v-model="consignorMobile"
              placeholder="电话"
            />
            <textarea
              v-model="consignorAddress"
              class="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
              placeholder="详细地址"
            />
          </fieldset>
          <fieldset class="space-y-3 rounded-lg border p-4">
            <legend class="px-1 text-sm font-medium">收件人</legend>
            <Input v-model="consigneePerson" placeholder="联系人" /><Input
              v-model="consigneeMobile"
              placeholder="电话"
            />
            <textarea
              v-model="consigneeAddress"
              class="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
              placeholder="详细地址"
            />
          </fieldset>
        </div>
        <Button
          class="mt-5"
          :disabled="createOrderBlocked || !selectedQuote || createOrder.isPending.value"
          @click="createOrder.mutate()"
        >
          <PackageCheck class="size-4" />{{ createOrderBlocked ? '真实下单保持禁用' : '提交物流订单' }}
        </Button>
        <p v-if="!selectedQuote" class="mt-2 text-xs text-amber-700">请先在“运费试算”生成可用方案。</p>
        <ErrorNotice v-if="createOrder.error.value" class="mt-3" :error="createOrder.error.value" compact />
      </Card>
      <Card class="p-5">
        <div class="flex items-center gap-2">
          <PackageCheck class="size-4 text-primary" />
          <h2 class="font-semibold">提交结果</h2>
        </div>
        <div
          v-if="createOrder.data.value"
          class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4"
        >
          <Badge variant="success">演示下单成功</Badge>
          <p class="mt-3 font-mono text-sm">{{ createOrder.data.value.orderNumber }}</p>
        </div>
        <p v-else class="mt-4 text-sm text-muted-foreground">本工作台不会持久化草稿中的个人信息。</p>
      </Card>
    </div>
  </template>
</template>
