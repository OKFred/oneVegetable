<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Copy, ExternalLink, Link2, RefreshCw, Unplug } from '@lucide/vue';
import { toast } from 'vue-sonner';

import type { ExtensionSocialBackendStatus } from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import { useUiI18n } from '../i18n';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';

const { extensionSocialBackend, socialPublishing } = useServices();
const { t } = useUiI18n();
const status = ref<ExtensionSocialBackendStatus | null>(null);
const baseUrl = ref('');
const deviceName = ref(t('settings.socialBackend.defaultDeviceName'));
const busy = ref(false);
const error = ref<unknown>(null);
const disconnectConfirmation = ref(false);

const stateLabel = computed(() => {
  if (status.value === null) return t('settings.socialBackend.states.loading');
  if (status.value.state === 'paired') return t('settings.socialBackend.states.paired');
  if (status.value.state === 'pending') return t('settings.socialBackend.states.pending');
  if (status.value.state === 'expired') return t('settings.socialBackend.states.expired');
  return t('settings.socialBackend.states.unconfigured');
});
const formattedPairingCode = computed(() =>
  (status.value?.pairingCode ?? '').replace(/(.{4})(?=.)/gu, '$1-')
);
const adminUrl = computed(() => (status.value?.baseUrl ? `${status.value.baseUrl}/#/admin` : ''));

onMounted(refreshStatus);

async function refreshStatus(): Promise<void> {
  if (!extensionSocialBackend) return;
  busy.value = true;
  error.value = null;
  try {
    const current = await extensionSocialBackend.status();
    status.value = current;
    if (current.baseUrl) baseUrl.value = current.baseUrl;
    if (current.deviceName) deviceName.value = current.deviceName;
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function startPairing(): Promise<void> {
  if (!extensionSocialBackend) return;
  busy.value = true;
  error.value = null;
  try {
    status.value = await extensionSocialBackend.start(baseUrl.value, deviceName.value);
    toast.success(t('settings.socialBackend.pairCreated'));
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function pollPairing(): Promise<void> {
  if (!extensionSocialBackend) return;
  busy.value = true;
  error.value = null;
  try {
    status.value = await extensionSocialBackend.refresh();
    if (status.value.state === 'paired') toast.success(t('settings.socialBackend.pairSucceeded'));
    else if (status.value.state === 'pending') toast.info(t('settings.socialBackend.pairPending'));
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function disconnect(): Promise<void> {
  if (!extensionSocialBackend) return;
  busy.value = true;
  error.value = null;
  try {
    status.value = await extensionSocialBackend.disconnect();
    baseUrl.value = '';
    disconnectConfirmation.value = false;
    toast.success(t('settings.socialBackend.disconnected'));
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function verifyConnection(): Promise<void> {
  if (!socialPublishing) return;
  busy.value = true;
  error.value = null;
  try {
    const destinations = await socialPublishing.listSocialDestinations();
    const publishable = destinations.filter((destination) => destination.canPublish).length;
    toast.success(t('settings.socialBackend.connectionHealthy', { total: destinations.length, publishable }));
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function copyPairingCode(): Promise<void> {
  const code = status.value?.pairingCode;
  if (!code) return;
  await globalThis.navigator.clipboard.writeText(code);
  toast.success(t('settings.socialBackend.codeCopied'));
}
</script>

<template>
  <Card class="p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <Link2 class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('settings.socialBackend.title') }}</h2>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ t('settings.socialBackend.description') }}
        </p>
      </div>
      <Badge :variant="status?.state === 'paired' ? 'success' : 'secondary'">{{ stateLabel }}</Badge>
    </div>

    <ErrorNotice
      v-if="error"
      class="mt-3"
      :error="error"
      :fallback="t('settings.socialBackend.operationFailed')"
      compact
    />

    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <label class="text-sm font-medium sm:col-span-2">
        {{ t('settings.socialBackend.baseUrl') }}
        <Input
          v-model="baseUrl"
          class="mt-2"
          type="url"
          placeholder="https://your-worker.workers.dev"
          :disabled="busy || status?.state === 'paired'"
        />
      </label>
      <label class="text-sm font-medium">
        {{ t('settings.socialBackend.deviceName') }}
        <Input
          v-model="deviceName"
          class="mt-2"
          maxlength="80"
          :disabled="busy || status?.state === 'paired'"
        />
      </label>
      <div class="text-sm">
        <p class="font-medium">{{ t('settings.socialBackend.extensionId') }}</p>
        <code class="mt-2 block break-all rounded-md bg-muted px-3 py-2 text-xs">
          {{ status?.extensionId }}
        </code>
      </div>
    </div>

    <div v-if="status?.state === 'pending'" class="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p class="text-sm font-medium">{{ t('settings.socialBackend.approveTitle') }}</p>
      <div class="mt-2 flex items-center gap-2">
        <code class="text-lg font-semibold tracking-wider">{{ formattedPairingCode }}</code>
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('settings.socialBackend.copyCode')"
          @click="copyPairingCode"
        >
          <Copy class="size-4" />
        </Button>
      </div>
      <p class="mt-2 text-xs text-muted-foreground">
        {{
          t('settings.socialBackend.expires', {
            time: formatDateTime(status.pairingExpiresTimeUtc ?? 0)
          })
        }}
      </p>
      <a
        v-if="adminUrl"
        :href="adminUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {{ t('settings.socialBackend.openAdmin') }}<ExternalLink class="size-3.5" />
      </a>
    </div>

    <div v-if="status?.state === 'paired' && status.device" class="mt-4 rounded-lg bg-muted/40 p-4 text-sm">
      <p class="font-medium">{{ status.device.name }}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {{
          t('settings.socialBackend.authorizationExpires', {
            time: formatDateTime(status.device.expiresTimeUtc)
          })
        }}
      </p>
    </div>

    <div
      v-if="status?.state === 'expired'"
      class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
    >
      <p class="font-medium">{{ t('settings.socialBackend.expiredTitle') }}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t('settings.socialBackend.expiredDescription') }}
      </p>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <Button
        v-if="status && status.state !== 'paired' && status.state !== 'pending'"
        :disabled="busy || !baseUrl.trim() || !deviceName.trim()"
        @click="startPairing"
      >
        <Link2 class="size-4" />{{
          status.state === 'expired'
            ? t('settings.socialBackend.pairAgain')
            : t('settings.socialBackend.startPairing')
        }}
      </Button>
      <Button v-if="status?.state === 'pending'" :disabled="busy" @click="pollPairing">
        <RefreshCw class="size-4" />{{ t('settings.socialBackend.checkApproval') }}
      </Button>
      <Button
        v-if="status?.state === 'paired' && socialPublishing"
        variant="outline"
        :disabled="busy"
        @click="verifyConnection"
      >
        <RefreshCw class="size-4" />{{ t('settings.socialBackend.checkConnection') }}
      </Button>
      <Button
        v-if="status && status.state !== 'unconfigured'"
        variant="outline"
        :disabled="busy"
        @click="disconnectConfirmation = true"
      >
        <Unplug class="size-4" />{{ t('settings.socialBackend.disconnect') }}
      </Button>
    </div>
  </Card>

  <ConfirmActionDialog
    :open="disconnectConfirmation"
    :title="t('settings.socialBackend.disconnectTitle')"
    :description="t('settings.socialBackend.disconnectDescription')"
    :confirm-label="t('settings.socialBackend.disconnectConfirm')"
    destructive
    :pending="busy"
    @update:open="disconnectConfirmation = $event"
    @confirm="disconnect"
  />
</template>
