<script setup lang="ts">
import { h, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { FilePlus2, Search } from '@lucide/vue';

import { validateSchemaPublishInput, type Product } from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

const { gateway } = useServices();
const queryClient = useQueryClient();
const subject = ref('');
const showPublisher = ref(false);
const categoryId = ref('100003109');
const schemaXml = ref('<itemSchema><field id="productTitle"><value></value></field></itemSchema>');
const formErrors = ref<string[]>([]);
const feedback = ref('');

const products = useQuery({
  queryKey: ['products', subject],
  queryFn: () => gateway.request('listProducts', { page: 1, pageSize: 20, subject: subject.value })
});
const publish = useMutation({
  mutationFn: async (draft: boolean) => {
    const payload = { categoryId: Number(categoryId.value), language: 'en_US', schemaXml: schemaXml.value };
    const validation = validateSchemaPublishInput(payload);
    formErrors.value = validation.errors;
    if (!validation.valid) throw new Error('请修正 Schema 表单');
    return draft ? gateway.request('saveProductDraft', payload) : gateway.request('publishProduct', payload);
  },
  onSuccess: async (result, draft) => {
    feedback.value = `${draft ? '草稿已保存' : '商品已发布'}：${result.productId}`;
    await queryClient.invalidateQueries({ queryKey: ['products'] });
  }
});

function statusVariant(status: Product['status']): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'online') return 'success';
  if (status === 'auditing') return 'warning';
  if (status === 'rejected') return 'destructive';
  return 'secondary';
}

const columns: DataColumn<Product>[] = [
  {
    accessorKey: 'subject',
    header: '商品',
    cell: (context) => h('div', { class: 'font-medium' }, context.getValue<string>())
  },
  { accessorKey: 'groupName', header: '分组' },
  {
    accessorKey: 'status',
    header: '状态',
    cell: (context) =>
      h(Badge, { variant: statusVariant(context.getValue<Product['status']>()) }, () =>
        context.getValue<string>()
      )
  },
  { accessorKey: 'score', header: '质量分', cell: (context) => `${context.getValue<number>()}/100` },
  {
    accessorKey: 'updatedAt',
    header: '更新时间',
    cell: (context) => new Date(context.getValue<string>()).toLocaleString('zh-CN')
  }
];
</script>

<template>
  <PageHeader
    title="商品管理"
    description="旧发品接口不再作为主路径；创建、草稿和更新统一使用官方 Schema 流程。"
  >
    <Button @click="showPublisher = !showPublisher"><FilePlus2 class="size-4" />Schema 发品</Button>
  </PageHeader>
  <Card v-if="showPublisher" class="mb-5 p-5">
    <div class="grid gap-4 lg:grid-cols-[220px_1fr]">
      <label class="text-sm font-medium"
        >类目 ID<Input v-model="categoryId" class="mt-2" inputmode="numeric"
      /></label>
      <label class="text-sm font-medium"
        >Schema XML<textarea
          v-model="schemaXml"
          class="mt-2 min-h-28 w-full rounded-md border bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
    </div>
    <ul v-if="formErrors.length" class="mt-3 text-sm text-destructive">
      <li v-for="error in formErrors" :key="error">{{ error }}</li>
    </ul>
    <p v-if="feedback" class="mt-3 text-sm text-emerald-700">{{ feedback }}</p>
    <div class="mt-4 flex gap-2">
      <Button :disabled="publish.isPending.value" @click="publish.mutate(false)">发布商品</Button
      ><Button variant="outline" :disabled="publish.isPending.value" @click="publish.mutate(true)"
        >保存草稿</Button
      >
    </div>
  </Card>
  <div class="mb-4 flex max-w-md items-center gap-2">
    <div class="relative flex-1">
      <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input
        v-model="subject"
        class="pl-9"
        placeholder="按标题搜索"
      />
    </div>
  </div>
  <QueryState :loading="products.isPending.value" :error="products.error.value">
    <DataTable :columns="columns" :data="products.data.value?.items ?? []" empty-text="没有匹配商品" />
  </QueryState>
</template>
