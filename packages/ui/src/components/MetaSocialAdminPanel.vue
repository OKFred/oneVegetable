<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  Camera,
  Copy,
  Link2,
  MessageCircle,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unplug
} from '@lucide/vue';
import { toast } from 'vue-sonner';

import type {
  MetaAppConfigurationSummary,
  ExtensionSocialDevice,
  SocialAccountConnection,
  SocialDestination
} from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import { useUiI18n } from '../i18n';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';

const { control } = useServices();
const { t } = useUiI18n();
const configuration = ref<MetaAppConfigurationSummary | null>(null);
const connections = ref<SocialAccountConnection[]>([]);
const destinations = ref<SocialDestination[]>([]);
const devices = ref<ExtensionSocialDevice[]>([]);
const pairingCode = ref('');
const appId = ref('');
const appSecret = ref('');
const publicOrigin = ref(globalThis.location.origin);
const remark = ref('');
const loading = ref(false);
const error = ref<unknown>(null);
const pairingRefreshState = ref<'idle' | 'waiting' | 'timeout'>('idle');
let pairingDeviceIdsBeforeApproval = new Set<string>();
let pairingRefreshAttempts = 0;
let pairingRefreshTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
const pairingRefreshIntervalMilliseconds = 1_500;
const pairingRefreshAttemptLimit = 20;
const confirmation = ref<
  | { kind: 'save' }
  | { kind: 'clear' }
  | { kind: 'disconnect'; connection: SocialAccountConnection }
  | { kind: 'approve-pairing' }
  | { kind: 'revoke-device'; device: ExtensionSocialDevice }
  | null
>(null);

const supported = computed(
  () =>
    control !== undefined &&
    'metaAppConfiguration' in control &&
    'updateMetaAppConfiguration' in control &&
    'listMetaConnections' in control
);
const deviceManagementSupported = computed(
  () =>
    control !== undefined &&
    'approveExtensionSocialPairing' in control &&
    'listExtensionSocialDevices' in control &&
    'revokeExtensionSocialDevice' in control
);
const runtimeLabel = computed(() => {
  const current = configuration.value;
  if (!current?.apiRuntime) return '';
  const runtime = current.apiRuntime === 'cloudflare' ? 'Cloudflare Worker' : 'Node.js';
  const storage =
    current.mediaStorage === 'r2'
      ? t('admin.meta.runtime.r2')
      : current.mediaStorage === 'filesystem'
        ? t('admin.meta.runtime.filesystem')
        : t('admin.meta.runtime.unavailable');
  return `${runtime} · ${storage}`;
});
const runtimeDescription = computed(() => {
  const current = configuration.value;
  if (!current?.apiRuntime) return '';
  if (current.runtimeIssueCode === 'SOCIAL_MEDIA_STORAGE_UNAVAILABLE') {
    return t('admin.meta.runtime.storageIssue');
  }
  if (current.runtimeIssueCode === 'SOCIAL_PUBLISHING_SERVICE_UNAVAILABLE') {
    return t('admin.meta.runtime.serviceIssue');
  }
  return current.publishingRuntimeAvailable
    ? t('admin.meta.runtime.ready')
    : t('admin.meta.runtime.incomplete');
});
const confirmationTitle = computed(() => {
  if (confirmation.value?.kind === 'save') return t('admin.meta.confirmation.saveTitle');
  if (confirmation.value?.kind === 'clear') return t('admin.meta.confirmation.clearTitle');
  if (confirmation.value?.kind === 'approve-pairing') return t('admin.meta.confirmation.approveTitle');
  if (confirmation.value?.kind === 'revoke-device') return t('admin.meta.confirmation.revokeTitle');
  return t('admin.meta.confirmation.disconnectTitle');
});
const confirmationDescription = computed(() => {
  const value = confirmation.value;
  if (value?.kind === 'save') {
    return configuration.value?.configured
      ? appSecret.value
        ? t('admin.meta.confirmation.replaceSecret')
        : t('admin.meta.confirmation.keepSecret')
      : t('admin.meta.confirmation.firstSave');
  }
  if (value?.kind === 'clear') return t('admin.meta.confirmation.clear');
  if (value?.kind === 'approve-pairing') {
    return t('admin.meta.confirmation.approve');
  }
  if (value?.kind === 'revoke-device') {
    return t('admin.meta.confirmation.revoke', { name: value.device.name });
  }
  return value?.kind === 'disconnect'
    ? t('admin.meta.confirmation.disconnect', { name: value.connection.accountName })
    : '';
});

onMounted(async () => {
  showOAuthResult();
  globalThis.addEventListener('focus', handlePageForeground);
  globalThis.document.addEventListener('visibilitychange', handleVisibilityChange);
  await refresh();
});

onBeforeUnmount(() => {
  stopPairingRefreshTimer();
  globalThis.removeEventListener('focus', handlePageForeground);
  globalThis.document.removeEventListener('visibilitychange', handleVisibilityChange);
});

async function refresh(): Promise<void> {
  if (!supported.value || !control?.metaAppConfiguration || !control.listMetaConnections) return;
  loading.value = true;
  error.value = null;
  try {
    const [nextConfiguration, nextConnections, nextDestinations, nextDevices] = await Promise.all([
      control.metaAppConfiguration(),
      control.listMetaConnections(),
      control.listSocialDestinations?.() ?? Promise.resolve([]),
      control.listExtensionSocialDevices?.() ?? Promise.resolve([])
    ]);
    configuration.value = nextConfiguration;
    connections.value = nextConnections;
    destinations.value = nextDestinations;
    applyDevices(nextDevices);
    publicOrigin.value = nextConfiguration.publicOrigin ?? globalThis.location.origin;
    remark.value = nextConfiguration.remark ?? '';
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    loading.value = false;
  }
}

async function refreshDevices(): Promise<void> {
  if (!deviceManagementSupported.value || !control?.listExtensionSocialDevices) return;
  applyDevices(await control.listExtensionSocialDevices());
}

function applyDevices(nextDevices: ExtensionSocialDevice[]): void {
  devices.value = nextDevices;
  if (
    pairingRefreshState.value !== 'idle' &&
    nextDevices.some((device) => !pairingDeviceIdsBeforeApproval.has(device.id))
  ) {
    pairingRefreshState.value = 'idle';
    stopPairingRefreshTimer();
    toast.success(t('admin.meta.feedback.deviceClaimed'));
  }
}

function startPairingDeviceRefresh(): void {
  stopPairingRefreshTimer();
  pairingDeviceIdsBeforeApproval = new Set(devices.value.map((device) => device.id));
  pairingRefreshAttempts = 0;
  pairingRefreshState.value = 'waiting';
  schedulePairingDeviceRefresh();
}

function schedulePairingDeviceRefresh(): void {
  pairingRefreshTimer = globalThis.setTimeout(() => {
    void pollForPairedDevice();
  }, pairingRefreshIntervalMilliseconds);
}

async function pollForPairedDevice(): Promise<void> {
  pairingRefreshTimer = null;
  if (!isPairingRefreshWaiting()) return;
  pairingRefreshAttempts += 1;
  try {
    await refreshDevices();
  } catch {
    // A later poll or a foreground refresh can recover from a transient request failure.
  }
  if (!isPairingRefreshWaiting()) return;
  if (pairingRefreshAttempts >= pairingRefreshAttemptLimit) {
    pairingRefreshState.value = 'timeout';
    return;
  }
  schedulePairingDeviceRefresh();
}

function isPairingRefreshWaiting(): boolean {
  return pairingRefreshState.value === 'waiting';
}

function stopPairingRefreshTimer(): void {
  if (pairingRefreshTimer === null) return;
  globalThis.clearTimeout(pairingRefreshTimer);
  pairingRefreshTimer = null;
}

function handlePageForeground(): void {
  if (loading.value || !deviceManagementSupported.value) return;
  void refreshDevices().catch((cause: unknown) => {
    error.value = cause;
  });
}

function handleVisibilityChange(): void {
  if (globalThis.document.visibilityState === 'visible') handlePageForeground();
}

async function executeConfirmation(): Promise<void> {
  const action = confirmation.value;
  if (!action || !control) return;
  loading.value = true;
  error.value = null;
  try {
    if (action.kind === 'save') {
      if (!control.updateMetaAppConfiguration) throw new Error(t('admin.meta.errors.unsupportedConfig'));
      configuration.value = await control.updateMetaAppConfiguration({
        appId: appId.value.trim(),
        appSecret: appSecret.value.trim() || null,
        publicOrigin: publicOrigin.value.trim(),
        revision: configuration.value?.revision ?? null,
        remark: remark.value.trim() || null
      });
      appSecret.value = '';
      toast.success(t('admin.meta.feedback.configurationSaved'));
    } else if (action.kind === 'clear') {
      const revision = configuration.value?.revision;
      if (!control.clearMetaAppConfiguration || revision === null || revision === undefined) {
        throw new Error(t('admin.meta.errors.noConfiguration'));
      }
      await control.clearMetaAppConfiguration(revision);
      appId.value = '';
      appSecret.value = '';
      await refresh();
      toast.success(t('admin.meta.feedback.configurationCleared'));
    } else if (action.kind === 'disconnect') {
      if (!control.disconnectMetaConnection) throw new Error(t('admin.meta.errors.unsupportedDisconnect'));
      await control.disconnectMetaConnection(action.connection.id, action.connection.revision);
      await refresh();
      toast.success(t('admin.meta.feedback.disconnected', { name: action.connection.accountName }));
    } else if (action.kind === 'approve-pairing') {
      if (!control.approveExtensionSocialPairing) throw new Error(t('admin.meta.errors.unsupportedPairing'));
      await control.approveExtensionSocialPairing(pairingCode.value);
      pairingCode.value = '';
      startPairingDeviceRefresh();
      try {
        await refreshDevices();
      } catch {
        // Approval already succeeded; the background poll will retry the device list.
      }
      if (pairingRefreshState.value === 'waiting') {
        toast.success(t('admin.meta.feedback.pairingApproved'));
      }
    } else {
      if (!control.revokeExtensionSocialDevice) throw new Error(t('admin.meta.errors.unsupportedRevoke'));
      await control.revokeExtensionSocialDevice(action.device.id, action.device.revision);
      await refresh();
      toast.success(t('admin.meta.feedback.deviceRevoked', { name: action.device.name }));
    }
    confirmation.value = null;
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    loading.value = false;
  }
}

async function startOAuth(includeInstagram: boolean): Promise<void> {
  if (!control?.startMetaOAuth) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await control.startMetaOAuth(includeInstagram ? ['facebook', 'instagram'] : ['facebook']);
    globalThis.location.assign(result.authorizationUrl);
  } catch (cause: unknown) {
    error.value = cause;
    loading.value = false;
  }
}

async function copyCallback(): Promise<void> {
  const callback = configuration.value?.callbackUrl;
  if (!callback) return;
  await globalThis.navigator.clipboard.writeText(callback);
  toast.success(t('admin.meta.feedback.callbackCopied'));
}

function showOAuthResult(): void {
  const query = globalThis.location.hash.split('?')[1];
  if (!query) return;
  const parameters = new URLSearchParams(query);
  const result = parameters.get('meta');
  if (result === 'connected') toast.success(t('admin.meta.feedback.connected'));
  else if (result === 'failed') {
    toast.error(
      t('admin.meta.feedback.connectionFailed', {
        reason: parameters.get('reason') ?? t('admin.meta.feedback.unknownReason')
      })
    );
  }
}

function destinationCount(connectionId: string): number {
  return destinations.value.filter((destination) => destination.connectionId === connectionId).length;
}
</script>

<template>
  <Card v-if="supported" class="mt-5 overflow-hidden">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b p-5">
      <div>
        <h2 class="font-semibold">{{ t('admin.meta.title') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('admin.meta.description') }}
        </p>
      </div>
      <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
        <RefreshCw class="size-4" />{{ t('admin.meta.refresh') }}
      </Button>
    </div>

    <div class="grid gap-5 p-5 xl:grid-cols-[0.9fr_1.1fr]">
      <section class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="font-medium">{{ t('admin.meta.configuration.title') }}</h3>
          <Badge :variant="configuration?.configured ? 'success' : 'secondary'">
            {{
              configuration?.configured
                ? t('admin.meta.configuration.configured', { suffix: configuration.appIdSuffix })
                : t('admin.meta.configuration.notConfigured')
            }}
          </Badge>
        </div>
        <ErrorNotice v-if="error" :error="error" :fallback="t('admin.meta.errors.operation')" compact />
        <div
          v-if="configuration?.apiRuntime"
          class="rounded-lg border p-3"
          :class="
            configuration.publishingRuntimeAvailable
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-amber-500/40 bg-amber-500/5'
          "
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2 text-sm font-medium">
              <Server class="size-4 shrink-0" />
              <span class="truncate">{{ runtimeLabel }}</span>
            </div>
            <Badge :variant="configuration.publishingRuntimeAvailable ? 'success' : 'warning'">
              {{
                configuration.publishingRuntimeAvailable
                  ? t('admin.meta.runtime.readyBadge')
                  : t('admin.meta.runtime.actionRequired')
              }}
            </Badge>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">{{ runtimeDescription }}</p>
        </div>
        <label class="block space-y-1 text-sm">
          <span>{{ t('admin.meta.configuration.appId') }}</span>
          <Input v-model="appId" inputmode="numeric" placeholder="Meta App ID" autocomplete="off" />
        </label>
        <label class="block space-y-1 text-sm">
          <span>{{ t('admin.meta.configuration.appSecret') }}</span>
          <Input
            v-model="appSecret"
            type="password"
            :placeholder="
              configuration?.configured
                ? t('admin.meta.configuration.keepSecretPlaceholder')
                : t('admin.meta.configuration.requiredSecretPlaceholder')
            "
            autocomplete="new-password"
          />
        </label>
        <label class="block space-y-1 text-sm">
          <span>{{ t('admin.meta.configuration.publicOrigin') }}</span>
          <Input v-model="publicOrigin" type="url" placeholder="https://example.com" />
          <span class="block text-xs text-muted-foreground">
            {{ t('admin.meta.configuration.publicOriginDescription') }}
          </span>
        </label>
        <label class="block space-y-1 text-sm">
          <span>{{ t('admin.meta.configuration.remark') }}</span>
          <Input v-model="remark" maxlength="500" :placeholder="t('admin.meta.configuration.optional')" />
        </label>
        <div v-if="configuration?.callbackUrl" class="rounded-lg border bg-muted/30 p-3">
          <p class="text-xs text-muted-foreground">OAuth Callback</p>
          <div class="mt-1 flex items-center gap-2">
            <code class="min-w-0 flex-1 truncate text-xs">{{ configuration.callbackUrl }}</code>
            <Button
              variant="ghost"
              size="icon"
              :aria-label="t('admin.meta.configuration.callbackCopyAria')"
              @click="copyCallback"
            >
              <Copy class="size-4" />
            </Button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            :disabled="
              loading ||
              !appId.trim() ||
              (!configuration?.configured && !appSecret.trim()) ||
              !publicOrigin.trim()
            "
            @click="confirmation = { kind: 'save' }"
          >
            <Save class="size-4" />{{ t('admin.meta.configuration.save') }}
          </Button>
          <Button
            variant="outline"
            :disabled="loading || !configuration?.configured"
            @click="startOAuth(false)"
          >
            <Link2 class="size-4" />{{ t('admin.meta.configuration.connectFacebook') }}
          </Button>
          <Button
            variant="outline"
            :disabled="loading || !configuration?.configured"
            @click="startOAuth(true)"
          >
            <Camera class="size-4" />{{ t('admin.meta.configuration.connectBoth') }}
          </Button>
          <Button
            variant="ghost"
            :disabled="loading || !configuration?.configured"
            @click="confirmation = { kind: 'clear' }"
          >
            <Trash2 class="size-4" />{{ t('admin.meta.configuration.clear') }}
          </Button>
        </div>
      </section>

      <section class="space-y-4">
        <div>
          <h3 class="font-medium">{{ t('admin.meta.connections.title') }}</h3>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('admin.meta.connections.description') }}</p>
        </div>
        <p
          v-if="connections.length === 0"
          class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          {{ t('admin.meta.connections.empty') }}
        </p>
        <article v-for="connection in connections" :key="connection.id" class="rounded-lg border p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-medium">{{ connection.accountName }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {{
                  t('admin.meta.connections.summary', {
                    count: destinationCount(connection.id),
                    time: formatDateTime(connection.updateTimeUtc)
                  })
                }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Badge :variant="connection.status === 'connected' ? 'success' : 'warning'">
                {{
                  connection.status === 'connected'
                    ? t('admin.meta.connections.connected')
                    : t('admin.meta.connections.reconnect')
                }}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                :aria-label="t('admin.meta.connections.disconnectAria', { name: connection.accountName })"
                @click="confirmation = { kind: 'disconnect', connection }"
              >
                <Unplug class="size-4" />
              </Button>
            </div>
          </div>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <div
              v-for="destination in destinations.filter((item) => item.connectionId === connection.id)"
              :key="destination.id"
              class="rounded-md bg-muted/40 p-3 text-sm"
            >
              <div class="flex items-center gap-2">
                <MessageCircle v-if="destination.platform === 'facebook'" class="size-4" />
                <Camera v-else class="size-4" />
                <span class="min-w-0 flex-1 truncate font-medium">{{ destination.name }}</span>
                <Badge :variant="destination.canPublish ? 'success' : 'secondary'">
                  {{
                    destination.canPublish
                      ? t('admin.meta.connections.canPublish')
                      : t('admin.meta.connections.unavailable')
                  }}
                </Badge>
              </div>
              <p v-if="destination.unavailableReasonCode" class="mt-2 text-xs text-muted-foreground">
                {{ destination.unavailableReasonCode }}
              </p>
            </div>
          </div>
        </article>
      </section>
    </div>

    <section v-if="deviceManagementSupported" class="border-t p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <Smartphone class="size-4 text-primary" />
            <h3 class="font-medium">{{ t('admin.meta.devices.title') }}</h3>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('admin.meta.devices.description') }}
          </p>
        </div>
        <Badge variant="secondary">
          {{
            t('admin.meta.devices.activeCount', {
              count: devices.filter((device) => device.status === 'active').length
            })
          }}
        </Badge>
      </div>
      <div class="mt-4 flex flex-wrap items-end gap-2">
        <label class="min-w-64 flex-1 space-y-1 text-sm">
          <span>{{ t('admin.meta.devices.pairingCode') }}</span>
          <Input
            v-model="pairingCode"
            maxlength="19"
            autocomplete="one-time-code"
            placeholder="ABCD-EFGH-JKLM-NPQR"
          />
        </label>
        <Button
          :disabled="loading || pairingCode.replaceAll('-', '').trim().length !== 16"
          @click="confirmation = { kind: 'approve-pairing' }"
        >
          <ShieldCheck class="size-4" />{{ t('admin.meta.devices.approve') }}
        </Button>
      </div>
      <div
        v-if="pairingRefreshState !== 'idle'"
        class="mt-3 flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
        role="status"
        aria-live="polite"
      >
        <RefreshCw
          class="mt-0.5 size-4 shrink-0 text-primary"
          :class="pairingRefreshState === 'waiting' ? 'animate-spin' : ''"
        />
        <div>
          <p class="font-medium">
            {{
              pairingRefreshState === 'waiting'
                ? t('admin.meta.devices.waiting')
                : t('admin.meta.devices.notClaimed')
            }}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {{
              pairingRefreshState === 'waiting'
                ? t('admin.meta.devices.waitingDescription')
                : t('admin.meta.devices.timeoutDescription')
            }}
          </p>
        </div>
      </div>
      <p
        v-if="devices.length === 0"
        class="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
      >
        {{ t('admin.meta.devices.empty') }}
      </p>
      <div v-else class="mt-4 grid gap-2 md:grid-cols-2">
        <article v-for="device in devices" :key="device.id" class="rounded-lg border p-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium">{{ device.name }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('admin.meta.devices.expires', { time: formatDateTime(device.expiresTimeUtc) }) }}
              </p>
              <p v-if="device.lastUsedTimeUtc" class="mt-1 text-xs text-muted-foreground">
                {{ t('admin.meta.devices.lastUsed', { time: formatDateTime(device.lastUsedTimeUtc) }) }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <Badge :variant="device.status === 'active' ? 'success' : 'secondary'">
                {{
                  device.status === 'active'
                    ? t('admin.meta.devices.active')
                    : device.status === 'expired'
                      ? t('admin.meta.devices.expired')
                      : t('admin.meta.devices.revoked')
                }}
              </Badge>
              <Button
                v-if="device.status === 'active'"
                variant="ghost"
                size="icon"
                :aria-label="t('admin.meta.devices.revokeAria', { name: device.name })"
                @click="confirmation = { kind: 'revoke-device', device }"
              >
                <Unplug class="size-4" />
              </Button>
            </div>
          </div>
        </article>
      </div>
    </section>
  </Card>

  <ConfirmActionDialog
    :open="confirmation !== null"
    :title="confirmationTitle"
    :description="confirmationDescription"
    :pending="loading"
    :destructive="
      confirmation?.kind === 'clear' ||
      confirmation?.kind === 'disconnect' ||
      confirmation?.kind === 'revoke-device'
    "
    @update:open="confirmation = $event ? confirmation : null"
    @confirm="executeConfirmation"
  />
</template>
