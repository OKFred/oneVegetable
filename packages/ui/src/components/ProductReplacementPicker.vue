<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { Product, ProductPage } from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { useShowcaseI18n } from '../i18n/showcase';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import TablePagination from './TablePagination.vue';
import ErrorNotice from './ErrorNotice.vue';
import ActionTooltip from './ActionTooltip.vue';

const props = defineProps<{ excludedIds: readonly string[] }>();
const emit = defineEmits<{ select: [product: Product] }>();
const { gateway } = useServices();
const { alibabaLanguage } = useAppPreferences();
const s = useShowcaseI18n();
const { t } = useUiI18n();
const subject = ref('');
const page = ref(1);
const pageSize = ref(10);
const result = shallowRef<ProductPage | null>(null);
const loading = ref(false);
const error = shallowRef<unknown>(null);
let generation = 0;
async function load(): Promise<void> {
  const attempt = ++generation;
  loading.value = true;
  error.value = null;
  result.value = null;
  try {
    const context = await gateway.galleryTransferContext?.();
    const response = await gateway.request(
      'listProducts',
      {
        page: page.value,
        pageSize: pageSize.value,
        subject: subject.value.trim(),
        language: alibabaLanguage.value
      },
      context ? { galleryContext: context } : undefined
    );
    const current = await gateway.galleryTransferContext?.();
    if (attempt === generation && JSON.stringify(current) === JSON.stringify(context))
      result.value = response;
  } catch (cause) {
    if (attempt === generation) error.value = cause;
  } finally {
    if (attempt === generation) loading.value = false;
  }
}
function reason(product: Product): string {
  return product.status !== 'online' || props.excludedIds.includes(product.id) ? s('replacementOnline') : '';
}
function search(): void {
  if (page.value !== 1) page.value = 1;
  else void load();
}
watch(
  [page, pageSize, alibabaLanguage],
  () => {
    void load();
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  generation++;
});
</script>
<template>
  <div class="space-y-3">
    <form class="flex gap-2" @submit.prevent="search">
      <Input v-model="subject" :placeholder="s('searchProducts')" :aria-label="s('searchProducts')" />
      <Button variant="outline" :disabled="loading" type="submit">{{ s('searchProducts') }}</Button>
    </form>
    <ErrorNotice v-if="error" :error="error" />
    <p v-if="loading" role="status">{{ t('common.columns.loading') }}</p>
    <p v-else-if="result?.items.length === 0">{{ s('noProducts') }}</p>
    <ul class="max-h-[45vh] space-y-2 overflow-y-auto">
      <li
        v-for="product in result?.items ?? []"
        :key="product.id"
        class="flex items-center gap-3 rounded-md border p-3"
      >
        <img
          v-if="product.imageUrl"
          :src="product.imageUrl"
          alt=""
          class="size-14 shrink-0 rounded object-cover"
          referrerpolicy="no-referrer"
        />
        <div class="min-w-0 flex-1">
          <p class="line-clamp-2 break-words">{{ product.subject }}</p>
          <code class="text-xs text-muted-foreground">{{ product.id }}</code>
        </div>
        <ActionTooltip :reason="reason(product)" :disabled="Boolean(reason(product))">
          <Button
            variant="outline"
            size="sm"
            :disabled="loading || Boolean(reason(product))"
            @click="emit('select', product)"
            >{{ s('choose') }}</Button
          >
        </ActionTooltip>
      </li>
    </ul>
    <TablePagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="result?.total ?? 0"
      :disabled="loading"
    />
  </div>
</template>
