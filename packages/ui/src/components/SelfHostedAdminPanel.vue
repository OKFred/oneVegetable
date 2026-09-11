<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { startRegistration } from '@simplewebauthn/browser';
import { Copy, KeyRound, PauseCircle, PlayCircle, RefreshCw, Shield, Sparkles } from '@lucide/vue';
import { toast } from 'vue-sonner';

import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import type { ControlPasskeyCredential, ControlRealMutationStatus } from '@one-vegetable/core';

import { useServices } from '../lib/services';
import { notifyGatewayConfigurationChanged } from '../lib/gateway-configuration-events';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import ModalDialog from './ui/ModalDialog.vue';
import AlibabaCloudCredentialAcquisitionDialog from './AlibabaCloudCredentialAcquisitionDialog.vue';
import { useUiI18n } from '../i18n';

type Confirmation =
  | { kind: 'pause'; paused: boolean }
  | { kind: 'passkey-remove'; credential: ControlPasskeyCredential }
  | { kind: 'recovery-codes' };

const { control } = useServices();
const { t } = useUiI18n();
const GatewayCredentialPanel = defineAsyncComponent(() => import('./GatewayCredentialPanel.vue'));
const credentialPanel = ref<{ reload: () => Promise<void> } | null>(null);
const mutationControl = ref<ControlRealMutationStatus | null>(null);
const passkeys = ref<ControlPasskeyCredential[]>([]);
const confirmation = ref<Confirmation | null>(null);
const recoveryCodes = ref<string[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);
const acquisitionOpen = ref(false);

const confirmationTitle = computed(() => {
  if (confirmation.value?.kind === 'passkey-remove') {
    return t('admin.selfHosted.confirmation.removePasskeyTitle');
  }
  if (confirmation.value?.kind === 'recovery-codes') {
    return t('admin.selfHosted.confirmation.recoveryTitle');
  }
  return t(
    confirmation.value?.paused
      ? 'admin.selfHosted.confirmation.pauseTitle'
      : 'admin.selfHosted.confirmation.resumeTitle'
  );
});
const confirmationDescription = computed(() => {
  if (confirmation.value?.kind === 'passkey-remove') {
    return t('admin.selfHosted.confirmation.removePasskeyDescription');
  }
  if (confirmation.value?.kind === 'recovery-codes') {
    return t('admin.selfHosted.confirmation.recoveryDescription');
  }
  return confirmation.value?.paused
    ? t('admin.selfHosted.confirmation.pauseDescription')
    : t('admin.selfHosted.confirmation.resumeDescription');
});

onMounted(refresh);

async function refresh(): Promise<void> {
  if (!control) return;
  loading.value = true;
  error.value = null;
  try {
    const [pauseStatus, credentialList] = await Promise.all([
      control.realMutationStatus?.() ?? Promise.resolve(null),
      control.listPasskeys?.() ?? Promise.resolve([])
    ]);
    mutationControl.value = pauseStatus;
    passkeys.value = credentialList;
  } catch (cause: unknown) {
    error.value = userError(cause, t('admin.selfHosted.errors.load'));
  } finally {
    loading.value = false;
  }
}

async function addPasskey(): Promise<void> {
  if (!control?.passkeyRegistrationOptions || !control.registerPasskey) return;
  error.value = null;
  try {
    const ceremony = await control.passkeyRegistrationOptions();
    const response = await startRegistration({
      optionsJSON: ceremony.options as unknown as PublicKeyCredentialCreationOptionsJSON
    });
    await control.registerPasskey(ceremony.challengeId, response, `Passkey ${passkeys.value.length + 1}`);
    toast.success(t('admin.selfHosted.feedback.passkeyRegistered'));
    await refresh();
  } catch (cause: unknown) {
    error.value = userError(cause, t('admin.selfHosted.errors.passkeyRegistration'));
  }
}

async function confirm(): Promise<void> {
  if (!control || !confirmation.value) return;
  loading.value = true;
  error.value = null;
  const action = confirmation.value;
  confirmation.value = null;
  try {
    if (action.kind === 'pause') {
      if (!control.updateRealMutationPause) {
        throw new Error(t('admin.selfHosted.errors.pauseUnsupported'));
      }
      mutationControl.value = await control.updateRealMutationPause(
        action.paused,
        mutationControl.value?.revision ?? null,
        t(action.paused ? 'admin.selfHosted.feedback.pauseRemark' : 'admin.selfHosted.feedback.resumeRemark')
      );
      toast.success(
        t(action.paused ? 'admin.selfHosted.feedback.paused' : 'admin.selfHosted.feedback.resumed')
      );
    } else if (action.kind === 'passkey-remove') {
      if (!control.removePasskey) throw new Error(t('admin.selfHosted.errors.passkeyUnsupported'));
      await control.removePasskey(action.credential.id);
      toast.success(t('admin.selfHosted.feedback.passkeyRemoved'));
    } else {
      if (!control.regenerateRecoveryCodes) {
        throw new Error(t('admin.selfHosted.errors.recoveryUnsupported'));
      }
      recoveryCodes.value = await control.regenerateRecoveryCodes();
    }
    await refresh();
  } catch (cause: unknown) {
    error.value = userError(cause, t('admin.selfHosted.errors.operation'));
  } finally {
    loading.value = false;
  }
}

async function credentialsAcquired(): Promise<void> {
  notifyGatewayConfigurationChanged();
  await credentialPanel.value?.reload();
}
async function copyRecoveryCodes(): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(recoveryCodes.value.join('\n'));
    toast.success(t('admin.selfHosted.feedback.recoveryCopied'));
  } catch {
    toast.error(t('admin.selfHosted.errors.copy'));
  }
}

function userError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback);
}
</script>

<template>
  <section class="mt-5 space-y-5" aria-labelledby="self-hosted-settings-title">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="self-hosted-settings-title" class="text-lg font-semibold">
          {{ t('admin.selfHosted.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">{{ t('admin.selfHosted.description') }}</p>
      </div>
      <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
        <RefreshCw class="size-4" />{{ t('common.actions.refresh') }}
      </Button>
    </div>

    <ErrorNotice v-if="error" :error="error" :fallback="t('admin.selfHosted.errors.panel')" />

    <div class="grid gap-5 xl:grid-cols-3">
      <GatewayCredentialPanel ref="credentialPanel">
        <Button size="sm" @click="acquisitionOpen = true"
          ><Sparkles class="size-4" />{{ t('admin.selfHosted.connect') }}</Button
        >
      </GatewayCredentialPanel>

      <Card class="p-5">
        <div class="flex items-center justify-between gap-3">
          <h3 class="flex items-center gap-2 font-semibold">
            <Shield class="size-4" />{{ t('admin.selfHosted.emergency') }}
          </h3>
          <span
            class="rounded-full px-2 py-1 text-xs"
            :class="mutationControl?.paused ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'"
          >
            {{
              mutationControl?.paused ? t('admin.selfHosted.allPaused') : t('admin.selfHosted.allowlistOpen')
            }}
          </span>
        </div>
        <p class="mt-4 text-sm text-muted-foreground">
          {{ t('admin.selfHosted.emergencyDescription') }}
        </p>
        <Button
          class="mt-4 w-full"
          :variant="mutationControl?.paused ? 'default' : 'destructive'"
          @click="confirmation = { kind: 'pause', paused: !mutationControl?.paused }"
        >
          <PlayCircle v-if="mutationControl?.paused" class="size-4" />
          <PauseCircle v-else class="size-4" />
          {{ mutationControl?.paused ? t('admin.selfHosted.resume') : t('admin.selfHosted.pause') }}
        </Button>
      </Card>

      <Card class="p-5">
        <div class="flex items-center justify-between gap-3">
          <h3 class="flex items-center gap-2 font-semibold">
            <KeyRound class="size-4" />{{ t('admin.selfHosted.passkeys') }}
          </h3>
          <Button size="sm" variant="outline" @click="addPasskey">{{ t('admin.selfHosted.add') }}</Button>
        </div>
        <div class="mt-4 space-y-2">
          <div
            v-for="credential in passkeys"
            :key="credential.id"
            class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
          >
            <div class="min-w-0">
              <p class="truncate font-medium">{{ credential.name }}</p>
              <p class="text-xs text-muted-foreground">{{ credential.deviceType }} · {{ credential.rpId }}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              :disabled="passkeys.length <= 1"
              @click="confirmation = { kind: 'passkey-remove', credential }"
            >
              {{ t('admin.selfHosted.remove') }}
            </Button>
          </div>
        </div>
        <Button
          class="mt-4 w-full"
          size="sm"
          variant="outline"
          @click="confirmation = { kind: 'recovery-codes' }"
        >
          {{ t('admin.selfHosted.regenerateRecovery') }}
        </Button>
      </Card>
    </div>

    <ConfirmActionDialog
      :open="confirmation !== null"
      :title="confirmationTitle"
      :description="confirmationDescription"
      :destructive="confirmation?.kind === 'pause' && confirmation.paused"
      :pending="loading"
      @update:open="confirmation = $event ? confirmation : null"
      @confirm="confirm"
    />

    <AlibabaCloudCredentialAcquisitionDialog
      v-model:open="acquisitionOpen"
      @completed="credentialsAcquired"
    />

    <ModalDialog
      :open="recoveryCodes.length > 0"
      :title="t('admin.selfHosted.recoveryTitle')"
      :description="t('admin.selfHosted.recoveryDescription')"
      size="md"
      @update:open="recoveryCodes = []"
    >
      <div class="grid grid-cols-2 gap-2 rounded-lg border bg-muted p-4 font-mono text-xs">
        <code v-for="code in recoveryCodes" :key="code" class="select-all break-all">{{ code }}</code>
      </div>
      <template #footer>
        <Button variant="outline" @click="copyRecoveryCodes"
          ><Copy class="size-4" />{{ t('admin.selfHosted.copy') }}</Button
        >
        <Button @click="recoveryCodes = []">{{ t('admin.selfHosted.saved') }}</Button>
      </template>
    </ModalDialog>
  </section>
</template>
