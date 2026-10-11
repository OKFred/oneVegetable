<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { KeyRound } from '@lucide/vue';
import type { AlibabaAuthorizationMetadata } from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { credentialExpiryState } from '../lib/credential-expiry';
import { formatDateTime } from '../lib/date-time';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { VAULT_UNLOCKED_EVENT } from '../lib/unsaved-editing';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import Card from './ui/Card.vue';
import Tooltip from './ui/Tooltip.vue';

const { mode, control, settings, vault } = useServices();
const t = useGatewayCredentialsI18n();
const now = ref(Date.now());
const loading = ref(true);
const expires = ref<number | null>(null);
const permission = ref<AlibabaAuthorizationMetadata['systemApiPermission']>('unknown');
const captured = ref<number | null>(null);
const reason = ref<'adminOnly' | 'empty' | 'unlockForExpiry' | 'expiryReadFailed' | null>(null);
const invalid = ref(false);
const expiry = computed(() => credentialExpiryState(expires.value, now.value));
const state = computed(() => (invalid.value ? 'invalid' : expiry.value.status));
const value = computed(() =>
  loading.value
    ? '—'
    : reason.value
      ? t('unknown')
      : state.value === 'valid' || state.value === 'expiring'
        ? t(`remaining${expiry.value.unit}`, { count: expiry.value.count })
        : state.value === 'unknown'
          ? t('unknown')
          : t(`expiry${state.value}`)
);
const reminder = computed(
  () =>
    (reason.value ? t(reason.value) : null) ??
    (state.value === 'unknown' ? t(`permission${permission.value}`) : t(`expiry${state.value}`))
);
const details = computed(() =>
  [
    reminder.value,
    expires.value === null ? t('expiryunknown') : `${t('expires')}: ${formatDateTime(expires.value)}`,
    t('permissionSnapshot', { time: formatDateTime(captured.value) }),
    t('systemApiHelp')
  ].join(' · ')
);
let generation = 0;
let timer: ReturnType<typeof globalThis.setInterval> | undefined;
const reload = () => {
  void load();
};

async function load(): Promise<void> {
  const current = ++generation;
  loading.value = true;
  expires.value = null;
  permission.value = 'unknown';
  captured.value = null;
  reason.value = null;
  invalid.value = false;
  try {
    if (mode === 'bff' && control) {
      const session = await control.session();
      if (current !== generation) return;
      if (session.principal.role !== 'admin') {
        reason.value = 'adminOnly';
        return;
      }
      const status = await control.gatewayCredentialStatus();
      if (current !== generation) return;
      expires.value = status.accessTokenExpiresTimeUtc;
      permission.value = status.systemApiPermission ?? 'unknown';
      captured.value = status.permissionCapturedTimeUtc ?? null;
      invalid.value = Boolean(status.lastRefreshErrorCode);
      if (status.errorCode) reason.value = 'expiryReadFailed';
      if (!status.configured && expires.value === null && !invalid.value) reason.value = 'empty';
    } else if (mode === 'extension' && vault) {
      const status = await vault.status();
      if (current !== generation) return;
      if (status.state !== 'unlocked' && status.state !== 'legacy') {
        reason.value = status.state === 'locked' ? 'unlockForExpiry' : 'empty';
        return;
      }
      if (!status.hasAccessToken) {
        reason.value = 'empty';
        return;
      }
      const metadata = await settings.load();
      if (current !== generation) return;
      expires.value = metadata.accessTokenExpiresTimeUtc ?? null;
      permission.value = metadata.systemApiPermission ?? 'unknown';
      captured.value = metadata.permissionCapturedTimeUtc ?? null;
    }
  } catch {
    if (current === generation) reason.value = 'expiryReadFailed';
  } finally {
    if (current === generation) loading.value = false;
  }
}
onMounted(() => {
  void load();
  timer = globalThis.setInterval(() => {
    now.value = Date.now();
  }, 60_000);
  globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, reload);
  globalThis.addEventListener(VAULT_UNLOCKED_EVENT, reload);
});
onBeforeUnmount(() => {
  generation++;
  globalThis.clearInterval(timer);
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, reload);
  globalThis.removeEventListener(VAULT_UNLOCKED_EVENT, reload);
});
</script>

<template>
  <Card class="p-5" data-testid="dashboard-authorization-card" :aria-busy="loading">
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-muted-foreground">{{ t('authorizationRemaining') }}</span>
      <Tooltip :text="details"
        ><button
          type="button"
          :aria-label="details"
          class="rounded text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <KeyRound class="size-4" /></button
      ></Tooltip>
    </div>
    <p class="mt-3 text-xl font-semibold" role="status">{{ value }}</p>
    <p
      v-if="!loading"
      class="mt-2 text-xs"
      :class="state === 'valid' && !reason ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'"
    >
      {{ reminder }}
    </p>
  </Card>
</template>
