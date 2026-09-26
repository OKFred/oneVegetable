<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { Product, ProductPage } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { pageDetailIdentity } from '../lib/page-details';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { useShowcaseI18n } from '../i18n/showcase';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import TablePagination from './TablePagination.vue';
import ErrorNotice from './ErrorNotice.vue';
import ActionTooltip from './ActionTooltip.vue';

const props = withDefaults(
  defineProps<{
    excludedIds?: readonly string[];
    onlineOnly?: boolean;
    expectedIdentity?: string;
    disabled?: boolean;
  }>(),
  { excludedIds: () => [], onlineOnly: false, disabled: false, expectedIdentity: '' }
);
const emit = defineEmits<{ select: [product: Product] }>();
const { gateway, mode } = useServices();
const { alibabaLanguage } = useAppPreferences();
const s = useShowcaseI18n();
const { t } = useUiI18n();
const subject = ref('');
const page = ref(1);
const pageSize = ref(10);
const result = shallowRef<ProductPage | null>(null);
const loading = ref(false);
const error = shallowRef<unknown>(null);
const loadedIdentity = ref('');
const selecting = ref(false);
let generation = 0;
function contextChanged(): never {
  throw new GatewayException({
    code: 'GALLERY_CONTEXT_CHANGED',
    message: 'GALLERY_CONTEXT_CHANGED',
    retryable: false
  });
}
async function load(): Promise<void> {
  const attempt = ++generation;
  loading.value = true;
  error.value = null;
  result.value = null;
  loadedIdentity.value = '';
  try {
    const context = await gateway.galleryTransferContext?.();
    const identity = context
      ? JSON.stringify([context.identity, context.gateway])
      : mode === 'mock'
        ? 'mock'
        : '';
    if (!identity || (props.expectedIdentity && identity !== props.expectedIdentity)) contextChanged();
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
    const current = await pageDetailIdentity(gateway, mode);
    if (current !== identity) contextChanged();
    if (attempt === generation) {
      result.value = response;
      loadedIdentity.value = identity;
    }
  } catch (cause) {
    if (attempt === generation) error.value = cause;
  } finally {
    if (attempt === generation) loading.value = false;
  }
}
function reason(product: Product): string {
  return (props.onlineOnly && product.status !== 'online') || props.excludedIds.includes(product.id)
    ? s('replacementOnline')
    : '';
}
async function select(product: Product): Promise<void> {
  if (props.disabled || loading.value || selecting.value || reason(product)) return;
  const attempt = generation;
  selecting.value = true;
  try {
    const current = await pageDetailIdentity(gateway, mode);
    if (attempt !== generation || isDisabled()) return;
    if (current !== loadedIdentity.value || (props.expectedIdentity && current !== props.expectedIdentity))
      contextChanged();
    emit('select', product);
  } catch (cause) {
    if (attempt === generation) {
      result.value = null;
      error.value = cause;
    }
  } finally {
    selecting.value = false;
  }
}
function isDisabled(): boolean {
  return props.disabled;
}
function search(): void {
  if (page.value !== 1) page.value = 1;
  else void load();
}
watch(
  [page, pageSize, alibabaLanguage, () => props.expectedIdentity],
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
      <Button variant="outline" :disabled="loading || selecting || disabled" type="submit">{{
        s('searchProducts')
      }}</Button>
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
            :disabled="loading || selecting || disabled || Boolean(reason(product))"
            @click="select(product)"
            >{{ s('choose') }}</Button
          >
        </ActionTooltip>
      </li>
    </ul>
    <TablePagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="result?.total ?? 0"
      :page-size-options="[10, 20, 30]"
      :disabled="loading || selecting || disabled"
    />
  </div>
</template>
