<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Clock3 } from '@lucide/vue';
import { useUiI18n } from '../i18n';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import { credentialExpiryState } from '../lib/credential-expiry';
import { formatDateTime } from '../lib/date-time';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { useServices } from '../lib/services';
import { VAULT_UNLOCKED_EVENT } from '../lib/unsaved-editing';
import Card from './ui/Card.vue';

const { mode, control, settings, vault } = useServices();
const t = useGatewayCredentialsI18n();
const { t: ui } = useUiI18n();
type LoadState =
  'loading' | 'ready' | 'empty' | 'locked' | 'adminOnly' | 'unavailable' | 'loadFailed' | 'demo';
const state = ref<LoadState>('loading');
const expires = ref<number | null>(null);
const invalid = ref(false);
const now = ref(Date.now());
const expiry = computed(() => credentialExpiryState(expires.value, now.value));
const status = computed(() => (invalid.value ? 'invalid' : expiry.value.status));
const warning = computed(
  () => state.value === 'ready' && ['expired', 'expiring', 'invalid'].includes(status.value)
);
const value = computed(() => {
  if (state.value === 'loading') return ui('common.actions.loading');
  if (state.value !== 'ready') return state.value === 'empty' ? t('empty') : '—';
  if (status.value === 'valid' || status.value === 'expiring')
    return t(`remaining${expiry.value.unit}`, { count: expiry.value.count });
  return t(
    status.value === 'unknown' ? 'unknown' : status.value === 'invalid' ? 'shortInvalid' : 'shortExpired'
  );
});
const description = computed(() =>
  state.value === 'loading' ? '' : state.value === 'ready' ? t(`expiry${status.value}`) : t(state.value)
);

let generation = 0;
let timer: ReturnType<typeof globalThis.setInterval> | undefined;
async function reload(): Promise<void> {
  const current = ++generation;
  state.value = 'loading';
  expires.value = null;
  invalid.value = false;
  now.value = Date.now();
  try {
    if (mode === 'mock') {
      state.value = 'demo';
    } else if (mode === 'extension') {
      const status = await vault?.status();
      if (current !== generation) return;
      if (!status) state.value = 'unavailable';
      else if (status.state === 'empty') state.value = 'empty';
      else if (status.state !== 'unlocked') state.value = 'locked';
      else if (!status.hasAccessToken) state.value = 'empty';
      else {
        const configuration = await settings.load();
        if (current !== generation) return;
        expires.value = configuration.accessTokenExpiresTimeUtc ?? null;
        state.value = 'ready';
      }
    } else if (control) {
      const session = await control.session();
      if (current !== generation) return;
      if (session.principal.role !== 'admin') {
        state.value = 'adminOnly';
        return;
      }
      const summary = await control.gatewayCredentialStatus();
      if (current !== generation) return;
      expires.value = summary.accessTokenExpiresTimeUtc;
      invalid.value = Boolean(summary.lastRefreshErrorCode);
      state.value = summary.configured || expires.value != null || invalid.value ? 'ready' : 'empty';
    } else state.value = 'unavailable';
  } catch {
    if (current === generation) state.value = 'loadFailed';
  }
}

function refreshStatus(): void {
  void reload();
}

onMounted(() => {
  void reload();
  // Update the countdown locally, never poll Alibaba to calculate remaining time.
  timer = globalThis.setInterval(() => {
    now.value = Date.now();
  }, 60_000);
  globalThis.addEventListener('focus', refreshStatus);
  globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, refreshStatus);
  globalThis.addEventListener(VAULT_UNLOCKED_EVENT, refreshStatus);
});
onBeforeUnmount(() => {
  generation += 1;
  if (timer !== undefined) globalThis.clearInterval(timer);
  globalThis.removeEventListener('focus', refreshStatus);
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, refreshStatus);
  globalThis.removeEventListener(VAULT_UNLOCKED_EVENT, refreshStatus);
});
</script>

<template>
  <Card
    class="flex min-w-0 flex-col p-5"
    data-testid="dashboard-authorization"
    :class="warning ? 'border-amber-500/50' : ''"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm text-muted-foreground">{{ t('remainingTitle') }}</p>
      <Clock3 class="size-4 shrink-0 text-primary" aria-hidden="true" />
    </div>
    <div role="status" :aria-busy="state === 'loading'">
      <p class="mt-3 text-2xl font-semibold" :class="warning ? 'text-amber-700 dark:text-amber-400' : ''">
        {{ value }}
      </p>
      <p class="mt-1 text-xs leading-5 text-muted-foreground">{{ description }}</p>
      <p v-if="state === 'ready' && expiry.status !== 'unknown'" class="mt-1 text-xs text-muted-foreground">
        {{ t('expires') }}: {{ formatDateTime(expires) }}
      </p>
    </div>
    <a
      href="#/settings"
      class="mt-3 w-fit rounded text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >{{ t('manageAuthorization') }}</a
    >
  </Card>
</template>
