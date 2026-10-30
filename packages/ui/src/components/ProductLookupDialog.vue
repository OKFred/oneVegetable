<script setup lang="ts">
import { computed, onScopeDispose, ref, useId, watch } from 'vue';
import {
  ProductLookupClient,
  type ProductLookupPage,
  type ProductLookupQuery
} from '../../../core/src/product-lookup';
import { useProductLookupI18n } from '../i18n/product-lookup';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { createProductReferenceSession } from '../lib/product-reference-session';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { productReferenceOnlineStateLabel } from '../lib/product-status';
import Dialog from './ui/ModalDialog.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import QueryState from './QueryState.vue';

const props = withDefaults(defineProps<{ open?: boolean }>(), { open: true });
const emit = defineEmits<{ close: []; select: [productId: string] }>();
const pl = useProductLookupI18n();
const inputId = useId();
const { gateway } = useServices();
const scope = useListIdentityScope();
const configurationEpoch = ref(0);
const identity = computed(() => JSON.stringify([scope.value, configurationEpoch.value]));
// Reuse exact-payload context selection and account/configuration isolation.
const session = createProductReferenceSession(gateway, () => identity.value);
const client = new ProductLookupClient(session.gateway);
const modelNumber = ref('');
const skuCode = ref('');
const result = ref<ProductLookupPage | null>(null);
const activeQuery = ref<ProductLookupQuery | null>(null);
const busy = ref(false);
const error = ref<Error | null>(null);
const invalidQuery = ref(false);
const closed = ref(false);
const isOpen = computed(() => props.open && !closed.value);
let sequence = 0;
let alive = true;

function reset(): void {
  sequence++;
  result.value = null;
  activeQuery.value = null;
  error.value = null;
  invalidQuery.value = false;
  busy.value = false;
}
function close(): void {
  const wasOpen = isOpen.value;
  closed.value = true;
  reset();
  if (wasOpen) emit('close');
}
function currentRequest(current: number): boolean {
  return alive && isOpen.value && current === sequence;
}
async function searchPage(query: ProductLookupQuery, pageIndex: number): Promise<void> {
  if (!isOpen.value || !alive) return;
  const current = ++sequence;
  result.value = null;
  error.value = null;
  invalidQuery.value = false;
  activeQuery.value = query;
  busy.value = true;
  try {
    const data = await client.search({ ...query, pageIndex, pageSize: 20 });
    if (currentRequest(current)) result.value = data;
  } catch (cause: unknown) {
    if (currentRequest(current)) error.value = cause instanceof Error ? cause : new Error(pl('failed'));
  } finally {
    if (currentRequest(current)) busy.value = false;
  }
}
async function search(): Promise<void> {
  if (!isOpen.value || !alive || busy.value) return;
  const model = modelNumber.value.trim();
  const sku = skuCode.value.trim();
  reset();
  if (Boolean(model) === Boolean(sku)) {
    invalidQuery.value = true;
    return;
  }
  await searchPage(model ? { modelNumber: model } : { skuCode: sku }, 1);
}
function changePage(direction: -1 | 1): void {
  const page = result.value;
  const query = activeQuery.value;
  if (!page || !query || busy.value) return;
  if ((direction === -1 && page.pageIndex <= 1) || (direction === 1 && !page.hasNextPage)) return;
  void searchPage(query, page.pageIndex + direction);
}
function choose(productId: string | null): void {
  if (isOpen.value && productId && result.value?.items.some((item) => item.productId === productId))
    emit('select', productId);
}
function invalidateConfiguration(): void {
  configurationEpoch.value++;
}
watch([modelNumber, skuCode], reset, { flush: 'sync' });
watch(
  () => props.open,
  (open) => {
    reset();
    closed.value = !open;
  },
  { flush: 'sync' }
);
watch(
  identity,
  () => {
    session.invalidate();
    close();
  },
  { flush: 'sync' }
);
globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, invalidateConfiguration);
onScopeDispose(() => {
  alive = false;
  sequence++;
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, invalidateConfiguration);
  session.dispose();
});
</script>

<template>
  <Dialog
    :open="isOpen"
    :title="pl('title')"
    :description="pl('readOnly')"
    size="lg"
    @update:open="!$event && close()"
  >
    <div class="space-y-4">
      <p class="text-xs text-muted-foreground">{{ pl('iopOnly') }}</p>
      <form class="space-y-3" @submit.prevent="search">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1">
            <label :for="inputId + '-model'" class="text-sm font-medium">{{ pl('modelNumber') }}</label>
            <Input
              :id="inputId + '-model'"
              v-model="modelNumber"
              :aria-label="pl('modelNumber')"
              :aria-invalid="invalidQuery"
              :aria-describedby="inputId + '-hint'"
              autocomplete="off"
              @keydown.enter.prevent="search"
            />
          </div>
          <div class="space-y-1">
            <label :for="inputId + '-sku'" class="text-sm font-medium">{{ pl('skuCode') }}</label>
            <Input
              :id="inputId + '-sku'"
              v-model="skuCode"
              :aria-label="pl('skuCode')"
              :aria-invalid="invalidQuery"
              :aria-describedby="inputId + '-hint'"
              autocomplete="off"
              @keydown.enter.prevent="search"
            />
          </div>
        </div>
        <div :id="inputId + '-hint'" class="space-y-1 text-xs text-muted-foreground">
          <p>{{ pl('skuHint') }}</p>
          <p>{{ pl('searchHint') }}</p>
        </div>
        <p v-if="invalidQuery" role="alert" class="text-sm text-destructive">{{ pl('invalidQuery') }}</p>
        <Button type="submit" :disabled="busy">{{ pl('search') }}</Button>
      </form>
      <p v-if="busy" role="status" class="text-sm">{{ pl('loading') }}</p>
      <QueryState :loading="busy" :error="error" layout="table">
        <template v-if="result">
          <p v-if="!result.items.length" role="status" class="py-5 text-center text-sm">{{ pl('empty') }}</p>
          <!-- Deliberately local: no shared table preferences, bulk selection, or mutation actions. -->
          <div v-else class="overflow-x-auto rounded-md border">
            <table class="w-full text-left text-sm">
              <caption class="sr-only">
                {{
                  pl('title')
                }}
              </caption>
              <thead class="border-b bg-muted/40">
                <tr>
                  <th scope="col" class="p-2">{{ pl('productId') }}</th>
                  <th scope="col" class="p-2">{{ pl('productTitle') }}</th>
                  <th scope="col" class="p-2">{{ pl('modelNumber') }}</th>
                  <th scope="col" class="p-2">{{ pl('status') }}</th>
                  <th scope="col" class="p-2">{{ pl('skus') }}</th>
                  <th scope="col" class="p-2">{{ pl('view') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, index) in result.items"
                  :key="(row.productId ?? 'unknown') + '-' + index"
                  class="border-b last:border-0"
                >
                  <td class="break-all p-2">{{ row.productId ?? pl('unknown') }}</td>
                  <td class="break-words p-2">{{ row.title ?? pl('unknown') }}</td>
                  <td class="break-words p-2">{{ row.modelNumber ?? pl('unknown') }}</td>
                  <td class="p-2">
                    {{ row.status === null ? pl('unknown') : productReferenceOnlineStateLabel(row.status) }}
                  </td>
                  <td class="p-2">
                    <ul v-if="row.skus?.length" class="space-y-1">
                      <li v-for="(sku, skuIndex) in row.skus" :key="skuIndex" class="break-all">
                        {{ pl('skuCode') }}: {{ sku.code ?? pl('unknown') }}; {{ pl('skuId') }}:
                        {{ sku.id ?? pl('unknown') }}
                      </li>
                    </ul>
                    <span v-else>{{ pl(row.skus === null ? 'unknown' : 'none') }}</span>
                  </td>
                  <td class="p-2">
                    <Button
                      v-if="row.productId"
                      variant="outline"
                      size="sm"
                      :aria-label="pl('view') + ' ' + row.productId"
                      @click="choose(row.productId)"
                      >{{ pl('view') }}</Button
                    >
                    <span v-else>{{ pl('unknown') }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs" aria-live="polite">
            <span>
              {{ pl('page') }} {{ result.pageIndex }}; {{ pl('totalItems') }}:
              {{ result.totalItems ?? pl('unknown') }}; {{ pl('totalPages') }}:
              {{ result.totalPages ?? pl('unknown') }}
            </span>
            <div class="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                :disabled="busy || result.pageIndex <= 1"
                @click="changePage(-1)"
                >{{ pl('previous') }}</Button
              >
              <Button
                size="sm"
                variant="outline"
                :disabled="busy || !result.hasNextPage"
                @click="changePage(1)"
                >{{ pl('next') }}</Button
              >
            </div>
          </div>
          <p v-if="result.totalItems === null" class="mt-2 text-xs text-muted-foreground">
            {{ pl('unknownTotal') }}
          </p>
        </template>
        <p v-else-if="!busy && !error" class="py-4 text-sm text-muted-foreground">{{ pl('firstSearch') }}</p>
      </QueryState>
    </div>
    <template #footer>
      <Button variant="outline" @click="close">{{ pl('close') }}</Button>
    </template>
  </Dialog>
</template>
