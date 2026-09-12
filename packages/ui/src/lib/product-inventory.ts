import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import type { GatewayClient, Product, ProductInventorySnapshot } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { pageDetailIdentity, requestPageDetail, usePageDetails } from './page-details';

export function useProductInventory(
  gateway: GatewayClient,
  mode: string,
  language: Ref<string>,
  rows: Ref<Product[]>,
  scope: Ref<string>
) {
  const source = ref<'product' | 'sku'>('product');
  const selected = shallowRef<Product | null>(null);
  const snapshots = shallowRef<Record<string, ProductInventorySnapshot>>({});
  const boundary = computed(() => JSON.stringify([scope.value, source.value]));
  let refresh = false;
  const runner = usePageDetails(
    rows,
    boundary,
    (row) => row.id,
    (row, identity) =>
      requestPageDetail(
        gateway,
        mode,
        language.value,
        { kind: 'inventory', id: row.id, source: source.value },
        identity,
        refresh
      ),
    (row, result) => {
      if (!('records' in result)) return;
      snapshots.value = { ...snapshots.value, [row.id]: result };
      if (result.status === 'failed' || result.status === 'drift')
        throw new GatewayException({
          code: result.reasonCode ?? 'INVENTORY_RESPONSE_INVALID',
          message: result.reasonCode ?? 'INVENTORY_RESPONSE_INVALID',
          retryable: false
        });
    },
    () => pageDetailIdentity(gateway, mode)
  );
  watch(boundary, () => {
    snapshots.value = {};
  });
  watch(scope, () => {
    selected.value = null;
  });
  watch(runner.securityFailure, (failed) => {
    if (failed) snapshots.value = {};
  });
  let pendingSelection = false;
  watch([selected, source], () => {
    pendingSelection = !!selected.value;
  });
  watch(
    [selected, source, runner.busy],
    () => {
      if (pendingSelection && selected.value && !runner.busy.value) {
        pendingSelection = false;
        void runner.load(false, [selected.value]);
      }
    },
    { flush: 'post' }
  );
  async function refreshSelected() {
    if (!selected.value || runner.busy.value) return;
    refresh = true;
    try {
      await runner.load(false, [selected.value]);
    } finally {
      refresh = false;
    }
  }
  return { ...runner, source, selected, snapshots, refreshSelected };
}
