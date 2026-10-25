import { computed, onScopeDispose, ref, watch } from 'vue';
import { ProductReferenceClient } from '@one-vegetable/core/product-reference';
import { createProductReferenceSession } from '../lib/product-reference-session';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';

export function useProductReference() {
  const { gateway } = useServices();
  const scope = useListIdentityScope();
  const configurationEpoch = ref(0);
  const identity = computed(() => JSON.stringify([scope.value, configurationEpoch.value]));
  const session = createProductReferenceSession(gateway, () => identity.value);
  const invalidate = () => {
    configurationEpoch.value++;
  };
  watch(identity, session.invalidate, { flush: 'sync' });
  globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, invalidate);
  onScopeDispose(() => {
    globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, invalidate);
    session.dispose();
  });
  return { client: new ProductReferenceClient(session.gateway), identity };
}
