<script setup lang="ts">
import { h } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { ShieldAlert } from '@lucide/vue';

import type { Order } from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Card from '../components/ui/Card.vue';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

const { gateway } = useServices();
const orders = useQuery({
  queryKey: ['orders'],
  queryFn: () => gateway.request('listOrders', { page: 1, pageSize: 20 })
});
const columns: DataColumn<Order>[] = [
  {
    accessorKey: 'id',
    header: '订单号',
    cell: (context) => h('code', { class: 'text-xs' }, context.getValue<string>())
  },
  { accessorKey: 'buyerName', header: '买家' },
  {
    id: 'amount',
    header: '金额',
    cell: ({ row }) => `${row.original.currency} ${row.original.amount.toLocaleString()}`
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: (context) => h(Badge, { variant: 'warning' }, () => context.getValue<string>())
  },
  {
    accessorKey: 'createdAt',
    header: '创建时间',
    cell: (context) => new Date(context.getValue<string>()).toLocaleString('zh-CN')
  },
  {
    id: 'detail',
    header: '详情能力',
    cell: () => h(Badge, { variant: 'outline' }, () => '摘要 / 资金 / 物流')
  }
];
</script>

<template>
  <PageHeader title="订单管理" description="使用非聚石塔的订单列表、资金和物流能力组合展示。" />
  <Card class="mb-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-amber-900">
    <ShieldAlert class="mt-0.5 size-4 shrink-0" />
    <p class="text-sm leading-5">
      <code>alibaba.seller.order.get</code>
      当前明确要求聚石塔内调用，因此不会伪造完整详情；不可用字段将在界面中保持缺失状态。
    </p>
  </Card>
  <QueryState :loading="orders.isPending.value" :error="orders.error.value">
    <DataTable :columns="columns" :data="orders.data.value?.items ?? []" />
  </QueryState>
</template>
