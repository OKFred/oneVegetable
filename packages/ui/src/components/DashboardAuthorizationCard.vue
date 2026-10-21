<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { KeyRound } from '@lucide/vue';
import type {
  AlibabaAuthorizationMetadata,
  AlibabaAuthorizationsSummary,
  ControlGatewayCredentialSummary
} from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { credentialExpiryState, credentialExpiryTone } from '../lib/credential-expiry';
import { formatDateTime } from '../lib/date-time';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { VAULT_UNLOCKED_EVENT } from '../lib/unsaved-editing';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import Card from './ui/Card.vue';
import Tooltip from './ui/Tooltip.vue';
import { parseAuthorizationSummary } from '../lib/alibaba-authorizations';

const { mode, control, settings, vault } = useServices();
const t = useGatewayCredentialsI18n();
const now = ref(Date.now());
const loading = ref(true);
const expires = ref<number | null>(null);
const tokenCaptured = ref<number | null>(null);
const permission = ref<AlibabaAuthorizationMetadata['systemApiPermission']>('unknown');
const captured = ref<number | null>(null);
const reason = ref<'adminOnly' | 'empty' | 'unlockForExpiry' | 'expiryReadFailed' | null>(null);
const refreshFailed = ref(false);
const authorizations = ref<AlibabaAuthorizationsSummary | null>(null);
const expiry = computed(() => credentialExpiryState(expires.value, now.value));
const state = computed(() => expiry.value.status);
const tone = computed(() =>
  loading.value || reason.value
    ? 'normal'
    : credentialExpiryTone(expires.value, tokenCaptured.value, now.value)
);
function expiryClass(value: ReturnType<typeof credentialExpiryTone>): string {
  return value === 'danger'
    ? 'text-red-700 dark:text-red-300'
    : value === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-foreground';
}
const toneClass = computed(() => expiryClass(tone.value));
function remainingText(time: number | null): string {
  const current = credentialExpiryState(time, now.value);
  return current.status === 'valid' || current.status === 'expiring'
    ? t(`compact${current.unit}`, { count: current.count })
    : current.status === 'expired'
      ? t('compactExpired')
      : t('unknown');
}
const value = computed(() =>
  loading.value ? '—' : reason.value ? t('unknown') : remainingText(expires.value)
);
const reminder = computed(
  () =>
    (reason.value ? t(reason.value) : null) ??
    (refreshFailed.value
      ? t('refreshFailed')
      : state.value === 'unknown'
        ? t(`permission${permission.value}`)
        : t(`expiry${state.value}`))
);
const profiles = computed(() =>
  (['top', 'iop'] as const).map((protocol) => {
    const summary = authorizations.value?.[protocol];
    const time = summary?.accessTokenExpiresTimeUtc ?? null;
    const status = credentialExpiryState(time, now.value).status;
    const unavailable = reason.value ?? summary?.errorCode;
    return {
      protocol,
      value: loading.value ? '—' : unavailable ? t('unknown') : remainingText(time),
      tone:
        loading.value || unavailable
          ? ('normal' as const)
          : credentialExpiryTone(time, summary?.accessTokenCapturedTimeUtc, now.value),
      details: [
        protocol.toUpperCase(),
        unavailable
          ? t(reason.value ?? 'expiryReadFailed')
          : summary?.lastRefreshErrorCode
            ? t('refreshFailed')
            : status === 'unknown'
              ? t(`permission${summary?.systemApiPermission ?? 'unknown'}`)
              : t(`expiry${status}`),
        time === null ? t('expiryunknown') : `${t('expires')}: ${formatDateTime(time)}`
      ].join(' · ')
    };
  })
);
const details = computed(() =>
  authorizations.value
    ? profiles.value.map((profile) => profile.details).join(' · ')
    : [
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

function applySingleProfile(status: ControlGatewayCredentialSummary | null): void {
  expires.value = status?.accessTokenExpiresTimeUtc ?? null;
  tokenCaptured.value = status?.accessTokenCapturedTimeUtc ?? null;
  permission.value = status?.systemApiPermission ?? 'unknown';
  captured.value = status?.permissionCapturedTimeUtc ?? null;
  refreshFailed.value = Boolean(status?.lastRefreshErrorCode);
  if (status?.errorCode) reason.value = 'expiryReadFailed';
  if (!status?.configured && expires.value === null) reason.value = 'empty';
}

function applyAuthorizations(next: AlibabaAuthorizationsSummary): void {
  // Show separate countdowns only when both profiles are configured; keep the legacy metadata path.
  if (next.top?.configured && next.iop?.configured) authorizations.value = next;
  else {
    authorizations.value = null;
    applySingleProfile(
      next.top?.configured ? next.top : next.iop?.configured ? next.iop : (next.top ?? next.iop)
    );
  }
}

async function load(): Promise<void> {
  const current = ++generation;
  now.value = Date.now();
  loading.value = true;
  expires.value = null;
  tokenCaptured.value = null;
  permission.value = 'unknown';
  captured.value = null;
  reason.value = null;
  refreshFailed.value = false;
  try {
    if (mode === 'bff' && control) {
      const session = await control.session();
      if (current !== generation) return;
      if (session.principal.role !== 'admin') {
        authorizations.value = null;
        reason.value = 'adminOnly';
        return;
      }
      if (control.gatewayAuthorizations) {
        try {
          const next = await parseAuthorizationSummary(await control.gatewayAuthorizations());
          if (current !== generation) return;
          applyAuthorizations(next);
          return;
        } catch {
          if (authorizations.value) {
            reason.value = 'expiryReadFailed';
            return;
          }
          // Optional metadata is unavailable on a legacy backend; keep its existing behavior.
        }
      }
      const status = await control.gatewayCredentialStatus();
      if (current !== generation) return;
      applySingleProfile(status);
    } else if (mode === 'extension' && vault) {
      const status = await vault.status();
      if (current !== generation) return;
      if (
        status.state !== 'unlocked' &&
        status.state !== 'legacy' &&
        !(status.state === 'locked' && status.gatewayAvailable === true)
      ) {
        authorizations.value = null;
        reason.value = status.state === 'locked' ? 'unlockForExpiry' : 'empty';
        return;
      }
      if (settings.authorizations) {
        try {
          const next = await parseAuthorizationSummary(await settings.authorizations());
          if (current !== generation) return;
          applyAuthorizations(next);
          return;
        } catch {
          if (authorizations.value) {
            reason.value = 'expiryReadFailed';
            return;
          }
        }
      }
      // A view lock permits only safe metadata. Never fall back to reading secrets.
      if (status.state === 'locked') {
        authorizations.value = null;
        reason.value = 'expiryReadFailed';
        return;
      }
      if (!status.hasAccessToken) {
        reason.value = 'empty';
        return;
      }
      const metadata = await settings.load();
      if (current !== generation) return;
      expires.value = metadata.accessTokenExpiresTimeUtc ?? null;
      tokenCaptured.value = metadata.accessTokenCapturedTimeUtc ?? null;
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
  <Card class="h-full min-w-0 p-5" data-testid="dashboard-authorization-card" :aria-busy="loading">
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-muted-foreground">{{ t('authorizationRemaining') }}</span>
      <Tooltip :text="details"
        ><span
          role="img"
          tabindex="0"
          :aria-label="details"
          data-testid="authorization-details"
          class="rounded text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <KeyRound class="size-4" aria-hidden="true" /></span
      ></Tooltip>
    </div>
    <div
      v-if="authorizations"
      class="mt-3 grid grid-cols-2 gap-3"
      data-testid="dashboard-dual-authorizations"
    >
      <div
        v-for="profile in profiles"
        :key="profile.protocol"
        class="min-w-0"
        :data-testid="`authorization-${profile.protocol}`"
      >
        <p class="text-xs text-muted-foreground">{{ profile.protocol.toUpperCase() }}</p>
        <p
          class="mt-1 truncate text-xl font-semibold"
          :class="expiryClass(profile.tone)"
          :data-tone="profile.tone"
          role="status"
        >
          {{ profile.value }}
        </p>
      </div>
    </div>
    <p
      v-else
      class="mt-3 whitespace-nowrap text-3xl font-semibold"
      :class="toneClass"
      :data-tone="tone"
      role="status"
    >
      {{ value }}
    </p>
  </Card>
</template>
