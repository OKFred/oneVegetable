import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue';

const identityScopeKey: InjectionKey<ComputedRef<string>> = Symbol('list-identity-scope');
/** Opaque identity/configuration IDs only. Not persisted with column preferences. */
export function provideListIdentityScope(scope: ComputedRef<string>): void {
  provide(identityScopeKey, scope);
}
export function useListIdentityScope(): ComputedRef<string> {
  return inject(
    identityScopeKey,
    computed(() => '')
  );
}
