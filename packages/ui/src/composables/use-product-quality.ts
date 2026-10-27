import { computed, ref, watch, type Ref } from 'vue';
import type { GatewayClient, Product, ProductScore } from '@one-vegetable/core';
import { pageDetailIdentity, requestPageDetail, usePageDetails } from '../lib/page-details';

export function useProductQuality(
  gateway: GatewayClient,
  mode: string,
  language: Ref<string>,
  account: Ref<unknown>,
  active: Ref<boolean>
) {
  const products = ref<Product[]>([]);
  const generation = ref(0);
  const results = ref<Record<string, { score: ProductScore; at: number; stale: boolean }>>({});
  const boundary = computed(() =>
    JSON.stringify([generation.value, account.value, language.value, products.value.map((p) => p.id)])
  );
  let refresh = false;
  const reads = usePageDetails(
    products,
    boundary,
    (p) => p.id,
    (product, identity) =>
      requestPageDetail(gateway, mode, language.value, { kind: 'score', id: product.id }, identity, refresh),
    (product, data) => {
      if ('score' in data)
        results.value = { ...results.value, [product.id]: { score: data, at: Date.now(), stale: false } };
    },
    () => pageDetailIdentity(gateway, mode)
  );
  watch(
    [account, language],
    () => {
      reads.stop();
      products.value = [];
      results.value = {};
    },
    { flush: 'sync' }
  );
  watch(
    active,
    (value) => {
      if (!value) reads.stop();
    },
    { flush: 'sync' }
  );
  function open(selection: Product[]): void {
    if (reads.busy.value || selection.length === 0 || selection.length > 30) return;
    products.value = selection.map((product) => ({ ...product }));
    generation.value++;
    results.value = {};
  }
  async function run(recheck = false, failedOnly = false): Promise<void> {
    if (!active.value || reads.busy.value) return;
    refresh = recheck;
    if (recheck)
      results.value = Object.fromEntries(
        Object.entries(results.value).map(([id, result]) => [id, { ...result, stale: true }])
      );
    await reads.load(failedOnly);
  }
  function invalidate(id: string): void {
    const result = results.value[id];
    if (result) results.value = { ...results.value, [id]: { ...result, stale: true } };
  }
  function record(id: string, score: ProductScore): void {
    if (products.value.some((product) => product.id === id))
      results.value = { ...results.value, [id]: { score, at: Date.now(), stale: false } };
  }
  return { products, results, reads, open, run, invalidate, record };
}
