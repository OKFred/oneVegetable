import { computed, onScopeDispose, ref } from 'vue';
import type { AlibabaAuthorizationsSummary } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { useServices } from './services';

/** Page-only validation boundary. Never pull a dynamic import into the MV3 worker graph. */
export async function parseAuthorizationSummary(value: unknown): Promise<AlibabaAuthorizationsSummary> {
  const { validateAlibabaAuthorizationsSummary } =
    await import('@one-vegetable/core/gateway-credential-validators');
  if (!validateAlibabaAuthorizationsSummary(value))
    throw new GatewayException({
      code: 'RESPONSE_CONTRACT_INVALID',
      message: 'RESPONSE_CONTRACT_INVALID',
      retryable: false
    });
  return value;
}

/** Metadata only. Never load a profile's secrets to display or bind authorizations. */
export function useAlibabaAuthorizations() {
  const { control, settings, mode } = useServices();
  const summary = ref<AlibabaAuthorizationsSummary | null>(null);
  const busy = ref(false);
  const error = ref<unknown>(null);
  const supported = computed(() =>
    mode === 'bff'
      ? typeof control?.gatewayAuthorizations === 'function'
      : typeof settings.authorizations === 'function'
  );
  const canConfirm = computed(() =>
    mode === 'bff'
      ? typeof control?.confirmGatewayAuthorizations === 'function'
      : typeof settings.confirmAuthorizations === 'function'
  );
  let generation = 0;
  onScopeDispose(reset);

  async function reload(): Promise<void> {
    if (!supported.value) return;
    const current = ++generation;
    busy.value = true;
    try {
      if (mode === 'bff' && control) {
        if ((await control.session()).principal.role !== 'admin') {
          if (current === generation) summary.value = null;
          return;
        }
      }
      if (current !== generation) return;
      const next =
        mode === 'bff' ? await control?.gatewayAuthorizations?.() : await settings.authorizations?.();
      const parsed = next ? await parseAuthorizationSummary(next) : null;
      if (current === generation && parsed) {
        summary.value = parsed;
        error.value = null;
      }
    } catch (cause) {
      // An older server may not implement the optional endpoint. Keep its single-profile UI.
      // Once dual support has been observed, retain metadata and show a failed reload honestly.
      if (current === generation && summary.value) error.value = cause;
    } finally {
      if (current === generation) busy.value = false;
    }
  }

  function reset(): void {
    generation++;
    summary.value = null;
    error.value = null;
    busy.value = false;
  }

  function invalidateBinding(): void {
    if (summary.value)
      summary.value = {
        ...summary.value,
        binding: {
          confirmed: false,
          topConfigurationId: null,
          iopConfigurationId: null,
          confirmedAtUtc: null
        }
      };
  }

  async function confirm(): Promise<void> {
    const topId = summary.value?.top?.configurationId;
    const iopId = summary.value?.iop?.configurationId;
    if (
      busy.value ||
      !canConfirm.value ||
      !topId ||
      !iopId ||
      !summary.value?.top?.configured ||
      !summary.value.iop?.configured
    )
      return;
    busy.value = true;
    error.value = null;
    try {
      const next =
        mode === 'bff'
          ? await control?.confirmGatewayAuthorizations?.(topId, iopId)
          : await settings.confirmAuthorizations?.(topId, iopId);
      if (next) summary.value = await parseAuthorizationSummary(next);
    } catch (cause) {
      // Stale configuration IDs are refused by the server. Do not retry a confirmation.
      await reload();
      error.value = cause;
    } finally {
      busy.value = false;
    }
  }

  return { summary, busy, error, supported, canConfirm, reload, reset, invalidateBinding, confirm };
}

export function hasConfirmedAlibabaBinding(summary: AlibabaAuthorizationsSummary): boolean {
  return Boolean(
    summary.top?.configured &&
    summary.iop?.configured &&
    summary.top.configurationId &&
    summary.iop.configurationId &&
    summary.binding.confirmed &&
    summary.binding.topConfigurationId === summary.top.configurationId &&
    summary.binding.iopConfigurationId === summary.iop.configurationId
  );
}
