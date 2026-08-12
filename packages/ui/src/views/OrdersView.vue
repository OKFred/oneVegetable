<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { Banknote, ClipboardList, FileSignature, MapPin, RefreshCw, ShieldAlert, Truck } from '@lucide/vue';

import type { TradeOrderDraft, TradeOrderSummary } from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

type Workspace = 'orders' | 'finance' | 'addresses' | 'assurance';

const { gateway, mode } = useServices();
const workspace = ref<Workspace>('orders');
const status = ref('');
const buyerLoginId = ref('');
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
const mutationBlocked = mode === 'extension';

const orders = useQuery({
  queryKey: computed(() => ['trade-orders', status.value, buyerLoginId.value]),
  queryFn: () =>
    gateway.request('listTradeOrders', {
      page: 1,
      pageSize: 50,
      ...(status.value ? { status: status.value } : {}),
      ...(buyerLoginId.value ? { buyerLoginId: buyerLoginId.value } : {})
    })
});
const selectedOrder = computed(() =>
  (orders.data.value?.items ?? []).find((order) => order.id === selectedOrderId.value)
);
const aggregate = useQuery({
  queryKey: computed(() => ['trade-order-aggregate', selectedOrderId.value]),
  enabled: computed(() => selectedOrder.value !== undefined),
  queryFn: () => {
    const order = selectedOrder.value;
    if (!order) throw new Error('请先选择订单');
    return gateway.request('getTradeOrderAggregate', { order });
  }
});
const fulfillmentChannels = useQuery({
  queryKey: ['trade-fulfillment-channels'],
  queryFn: () => gateway.request('listTradeFulfillmentChannels', { language: 'zh_CN' })
});
const serviceCharge = useQuery({
  queryKey: computed(() => ['trade-service-charge', serviceCurrency.value]),
  queryFn: () => gateway.request('getTradeServiceCharge', { currency: serviceCurrency.value })
});
const ttAccount = useQuery({
  queryKey: computed(() => ['trade-tt-account', selectedOrderId.value]),
  enabled: computed(() => selectedOrderId.value !== ''),
  queryFn: () => gateway.request('getTradeTtAccount', { orderId: selectedOrderId.value })
});
const addressSchema = useQuery({
  queryKey: computed(() => ['trade-address-schema', addressCountry.value]),
  enabled: computed(() => addressCountry.value.trim() !== ''),
  queryFn: () =>
    gateway.request('getTradeAddressSchema', {
      countryCode: addressCountry.value.trim().toUpperCase(),
      language: 'zh_CN'
    })
});
const addresses = useQuery({
  queryKey: computed(() => ['trade-addresses', buyerEmail.value]),
  enabled: computed(() => buyerEmail.value.includes('@')),
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
const createOrder = useMutation({
  mutationFn: () => gateway.request('createTradeOrder', orderDraft())
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
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '文档未返回';
}

const columns: DataColumn<TradeOrderSummary>[] = [
  {
    accessorKey: 'id',
    header: '订单号',
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
  { accessorKey: 'buyerLoginId', header: '买家登录名' },
  {
    id: 'amount',
    header: '金额',
    cell: ({ row }) => `${row.original.currency} ${row.original.amount}`
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: (context) => h(Badge, { variant: 'warning' }, () => context.getValue<string>())
  },
  {
    accessorKey: 'modifiedAt',
    header: '最后修改',
    cell: (context) => formatDate(context.getValue<string | null>())
  }
];

const workspaces: { id: Workspace; label: string }[] = [
  { id: 'orders', label: '订单与聚合详情' },
  { id: 'finance', label: '资金与履约' },
  { id: 'addresses', label: '地址 Schema' },
  { id: 'assurance', label: '信保订单草稿' }
];
</script>

<template>
  <PageHeader
    title="交易 / 订单工作台"
    description="订单、资金、物流、履约和地址能力采用稳定内部模型；原始 Alibaba 响应只在适配层处理。"
  />
  <Card class="mb-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-amber-900">
    <ShieldAlert class="mt-0.5 size-4 shrink-0" />
    <p class="text-sm leading-5">
      <code>alibaba.seller.order.get</code>
      仅允许聚石塔内调用，所以完整详情明确标记为不可用。页面只组合订单摘要、资金和物流；部分接口失败时保留其余结果。
    </p>
  </Card>

  <div class="mb-4 flex flex-wrap gap-2" aria-label="交易工作区">
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

  <template v-if="workspace === 'orders'">
    <Card class="mb-4 p-4">
      <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <Input v-model="buyerLoginId" placeholder="按买家登录名过滤" />
        <select v-model="status" class="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">全部订单状态</option>
          <option value="unpay">待付款</option>
          <option value="paid">已付款</option>
          <option value="undeliver">待发货</option>
          <option value="delivering">发货中</option>
          <option value="trade_success">交易完成</option>
          <option value="trade_close">交易关闭</option>
        </select>
        <Button variant="outline" :disabled="orders.isFetching.value" @click="orders.refetch()">
          <RefreshCw class="size-4" />刷新
        </Button>
      </div>
      <p v-if="orders.data.value?.documentTimeZoneUnverified" class="mt-3 text-xs text-amber-700">
        官方文档仅写“美国时间”，未给出精确时区；筛选值将原样发送，不擅自换算。
      </p>
    </Card>
    <QueryState :loading="orders.isPending.value" :error="orders.error.value">
      <DataTable :columns="columns" :data="orders.data.value?.items ?? []" empty-text="暂无匹配订单" />
    </QueryState>

    <Card v-if="selectedOrder" class="mt-5 p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="font-semibold">聚合详情 · {{ selectedOrder.id }}</p>
          <p class="mt-1 text-xs text-muted-foreground">不会调用聚石塔专用的完整详情接口</p>
        </div>
        <Badge variant="outline">fullDetail: jushita-only</Badge>
      </div>
      <QueryState :loading="aggregate.isPending.value" :error="aggregate.error.value">
        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <div class="rounded-lg border p-4">
            <ClipboardList class="mb-2 size-4 text-primary" />
            <p class="text-xs text-muted-foreground">订单摘要</p>
            <p class="mt-1 font-medium">{{ selectedOrder.currency }} {{ selectedOrder.amount }}</p>
            <p class="mt-1 text-xs">{{ selectedOrder.status }} · {{ formatDate(selectedOrder.createdAt) }}</p>
          </div>
          <div class="rounded-lg border p-4">
            <Banknote class="mb-2 size-4 text-primary" />
            <p class="text-xs text-muted-foreground">资金</p>
            <template v-if="aggregate.data.value?.fund">
              <p class="mt-1 font-medium">
                {{ aggregate.data.value.fund.currency }} {{ aggregate.data.value.fund.paidAmount }}
              </p>
              <p class="mt-1 text-xs">{{ aggregate.data.value.fund.status }}</p>
            </template>
            <Badge v-else variant="warning" class="mt-2">当前不可用</Badge>
          </div>
          <div class="rounded-lg border p-4">
            <Truck class="mb-2 size-4 text-primary" />
            <p class="text-xs text-muted-foreground">物流</p>
            <template v-if="aggregate.data.value?.logistics">
              <p class="mt-1 font-medium">{{ aggregate.data.value.logistics.status }}</p>
              <p class="mt-1 text-xs">
                {{ aggregate.data.value.logistics.carrier ?? '承运商未返回' }} ·
                {{ aggregate.data.value.logistics.trackingNumber ?? '单号未返回' }}
              </p>
            </template>
            <Badge v-else variant="warning" class="mt-2">当前不可用</Badge>
          </div>
        </div>
      </QueryState>
    </Card>
  </template>

  <template v-else-if="workspace === 'finance'">
    <div class="grid gap-4 xl:grid-cols-2">
      <Card class="p-5">
        <h2 class="font-semibold">履约通道</h2>
        <QueryState :loading="fulfillmentChannels.isPending.value" :error="fulfillmentChannels.error.value">
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
                {{ channel.enabled ? '可用' : '不可用' }}
              </Badge>
            </div>
          </div>
        </QueryState>
      </Card>
      <Card class="p-5">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold">服务费率</h2>
          <Input v-model="serviceCurrency" class="w-24" aria-label="服务费币种" />
        </div>
        <QueryState :loading="serviceCharge.isPending.value" :error="serviceCharge.error.value">
          <div
            v-for="(item, index) in serviceCharge.data.value?.items ?? []"
            :key="index"
            class="mt-3 rounded-lg border p-3 text-sm"
          >
            <p>费率 {{ item.ratio ?? '未返回' }} · 上限 {{ item.maxFee ?? '未返回' }}</p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ item.exportServiceType ?? '服务类型未返回' }} · {{ item.logisticsType ?? '物流类型未返回' }}
            </p>
          </div>
        </QueryState>
      </Card>
      <Card class="p-5 xl:col-span-2">
        <h2 class="font-semibold">订单 TT 汇款信息</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          选择订单后按需读取；账号信息只显示在当前内存中，不写入 localStorage 或扩展 storage。
        </p>
        <p v-if="!selectedOrderId" class="mt-4 text-sm text-muted-foreground">
          请先在“订单与聚合详情”选择订单。
        </p>
        <QueryState v-else :loading="ttAccount.isPending.value" :error="ttAccount.error.value">
          <div v-if="ttAccount.data.value" class="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <p>
              <span class="text-muted-foreground">应付：</span>{{ ttAccount.data.value.currency }}
              {{ ttAccount.data.value.payableAmount }}
            </p>
            <p>
              <span class="text-muted-foreground">收款人：</span
              >{{ ttAccount.data.value.accountName ?? '未返回' }}
            </p>
            <p>
              <span class="text-muted-foreground">银行：</span>{{ ttAccount.data.value.bankName ?? '未返回' }}
            </p>
            <p>
              <span class="text-muted-foreground">账号：</span
              ><code>{{ ttAccount.data.value.accountNumber ?? '未返回' }}</code>
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
          <span>目的国代码</span>
          <Input v-model="addressCountry" maxlength="2" placeholder="US" />
        </label>
        <label class="space-y-1 text-sm">
          <span>买家邮箱（仅用于当前查询）</span>
          <Input v-model="buyerEmail" type="email" placeholder="buyer@example.com" />
        </label>
      </div>
      <p class="mt-3 text-xs text-muted-foreground">邮箱和地址数据不会持久化；离开或刷新页面后即丢弃。</p>
    </Card>
    <div class="grid gap-4 xl:grid-cols-2">
      <Card class="p-5">
        <h2 class="font-semibold">官方地址表单 Schema</h2>
        <QueryState :loading="addressSchema.isPending.value" :error="addressSchema.error.value">
          <div class="mt-3 space-y-2">
            <div
              v-for="field in addressSchema.data.value?.fields ?? []"
              :key="field.id"
              class="rounded-lg border p-3"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">{{ field.label }}</span>
                <Badge v-if="field.required" variant="warning">必填</Badge>
                <Badge variant="outline">{{ field.type }}</Badge>
              </div>
              <code class="mt-1 block text-xs text-muted-foreground">{{ field.id }}</code>
            </div>
          </div>
        </QueryState>
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">地址簿</h2>
        <p v-if="!buyerEmail.includes('@')" class="mt-3 text-sm text-muted-foreground">
          输入有效邮箱后查询。
        </p>
        <QueryState v-else :loading="addresses.isPending.value" :error="addresses.error.value">
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
        <Button class="mt-4" variant="outline" disabled>新增地址（真实写入待账号验收）</Button>
      </Card>
    </div>
  </template>

  <template v-else>
    <Card class="p-5">
      <div class="flex items-start gap-3">
        <FileSignature class="mt-0.5 size-5 text-primary" />
        <div>
          <h2 class="font-semibold">信保订单草稿</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Web Mock 可验证草稿交互；扩展中的创建和修改始终禁用，直到取得账号并逐方法完成 smoke test。
          </p>
        </div>
      </div>
      <div class="mt-5 grid gap-3 md:grid-cols-2">
        <Input v-model="draftBuyer" placeholder="买家登录名" />
        <Input v-model="draftCurrency" placeholder="币种，例如 USD" />
        <Input v-model="draftProductId" placeholder="商品 ID" />
        <Input v-model="draftSubject" placeholder="商品名称" />
        <Input v-model="draftQuantity" inputmode="decimal" placeholder="数量" />
        <Input v-model="draftUnitPrice" inputmode="decimal" placeholder="单价" />
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <Button
          :disabled="mutationBlocked || !draftComplete || createOrder.isPending.value"
          @click="createOrder.mutate()"
        >
          创建 Mock 信保订单
        </Button>
        <Badge v-if="mutationBlocked" variant="warning">扩展真实写入已禁用</Badge>
        <Badge v-else variant="success">Web Mock</Badge>
      </div>
      <p v-if="createOrder.data.value" class="mt-3 text-sm text-emerald-700">
        Mock 创建成功：{{ createOrder.data.value.id }}
      </p>
      <p v-if="createOrder.error.value" class="mt-3 text-sm text-destructive">
        {{ createOrder.error.value.message }}
      </p>
    </Card>
  </template>
</template>
