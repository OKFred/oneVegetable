<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CheckCircle2, Download, ExternalLink, KeyRound, LoaderCircle, Save, ShieldAlert } from '@lucide/vue';

import type { AlibabaCredentialAcquisitionState, CredentialVaultStatus } from '@one-vegetable/core';

import AlibabaCredentialAcquisitionSteps from './AlibabaCredentialAcquisitionSteps.vue';
import AlibabaCredentialPrerequisiteGuide from './AlibabaCredentialPrerequisiteGuide.vue';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  saved: [status: CredentialVaultStatus];
}>();

const { alibabaCredentialAcquisition, vault } = useServices();
const { t } = useUiI18n();
const callbackUrl = ref('');
const state = ref<AlibabaCredentialAcquisitionState | null>(null);
const jobId = ref<string | null>(null);
const busy = ref(false);
const error = ref<unknown>(null);
const feedback = ref('');
const vaultStatus = ref<CredentialVaultStatus | null>(null);
const vaultPassphrase = ref('');
const vaultPassphraseConfirmation = ref('');
const plaintextAcknowledged = ref(false);
let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

const running = computed(() => state.value?.status === 'running');
const completed = computed(() => (state.value?.status === 'completed' ? state.value.credential : null));
const callbackChanged = computed(
  () =>
    state.value?.status === 'callback-confirmation-required' &&
    state.value.currentUrl !== state.value.requestedUrl
);

watch(
  () => props.open,
  (open) => {
    if (open) void initializeDialog();
    else stopPolling();
  },
  { immediate: true }
);

onBeforeUnmount(stopPolling);

async function start(): Promise<void> {
  if (!alibabaCredentialAcquisition) return;
  busy.value = true;
  error.value = null;
  feedback.value = '';
  try {
    const next = await alibabaCredentialAcquisition.start(callbackUrl.value.trim() || null);
    state.value = next;
    jobId.value = 'jobId' in next ? next.jobId : null;
    schedulePolling();
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function initializeDialog(): Promise<void> {
  await refreshVaultStatus();
  if (!alibabaCredentialAcquisition || state.value !== null) return;
  const prerequisite = await alibabaCredentialAcquisition.readPrerequisite().catch(() => null);
  if (prerequisite) state.value = prerequisite;
}

async function locatePrerequisiteField(): Promise<void> {
  if (!alibabaCredentialAcquisition) return;
  busy.value = true;
  error.value = null;
  try {
    const fieldId = await alibabaCredentialAcquisition.locatePrerequisiteField();
    feedback.value = fieldId
      ? t('admin.alibabaPrerequisite.feedback.fieldFocused')
      : t('admin.alibabaPrerequisite.feedback.fieldUnavailable');
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function focusPrerequisitePage(): Promise<void> {
  if (!alibabaCredentialAcquisition) return;
  busy.value = true;
  error.value = null;
  try {
    await alibabaCredentialAcquisition.focusPrerequisitePage();
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function refreshStatus(): Promise<void> {
  if (!alibabaCredentialAcquisition || !jobId.value || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    state.value = await alibabaCredentialAcquisition.status(jobId.value);
  } catch (cause: unknown) {
    error.value = cause;
    stopPolling();
  } finally {
    busy.value = false;
  }
  schedulePolling();
}

async function selectApplication(applicationId: string): Promise<void> {
  if (!alibabaCredentialAcquisition || !jobId.value) return;
  busy.value = true;
  error.value = null;
  try {
    state.value = await alibabaCredentialAcquisition.continue(jobId.value, {
      type: 'select-application',
      applicationId
    });
    schedulePolling();
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function confirmCallback(confirmed: boolean): Promise<void> {
  if (!alibabaCredentialAcquisition || !jobId.value) return;
  busy.value = true;
  error.value = null;
  try {
    state.value = await alibabaCredentialAcquisition.continue(jobId.value, {
      type: 'confirm-callback-change',
      confirmed
    });
    schedulePolling();
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function saveToVault(): Promise<void> {
  if (!alibabaCredentialAcquisition) return;
  if (vaultStatus.value?.state === 'empty') {
    if (vaultPassphrase.value.length < 6) {
      error.value = new Error(t('admin.credentialAcquisition.errors.passphraseLength'));
      return;
    }
    if (vaultPassphrase.value !== vaultPassphraseConfirmation.value) {
      error.value = new Error(t('admin.credentialAcquisition.errors.passphraseMismatch'));
      return;
    }
  }
  busy.value = true;
  error.value = null;
  try {
    const status = await alibabaCredentialAcquisition.saveToVault(
      vaultStatus.value?.state === 'empty' ? vaultPassphrase.value : undefined
    );
    vaultStatus.value = status;
    vaultPassphrase.value = '';
    vaultPassphraseConfirmation.value = '';
    feedback.value = t('admin.credentialAcquisition.feedback.saved');
    emit('saved', status);
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function exportCredentialBundle(): Promise<void> {
  if (!alibabaCredentialAcquisition || !plaintextAcknowledged.value) return;
  busy.value = true;
  error.value = null;
  try {
    const bundle = await alibabaCredentialAcquisition.exportBundle();
    downloadJson(bundle, 'credentialInfo.json');
    feedback.value = t('admin.credentialAcquisition.feedback.exported');
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function requestClose(): Promise<void> {
  stopPolling();
  if (alibabaCredentialAcquisition && jobId.value && state.value?.status !== 'prerequisite-required') {
    await alibabaCredentialAcquisition.cancel(jobId.value).catch(() => undefined);
  }
  reset();
  emit('update:open', false);
}

async function refreshVaultStatus(): Promise<void> {
  if (!vault) return;
  vaultStatus.value = await vault.status().catch(() => null);
}

function schedulePolling(): void {
  stopPolling();
  if (!props.open || !running.value) return;
  pollTimer = globalThis.setTimeout(() => {
    void refreshStatus();
  }, 1_000);
}

function stopPolling(): void {
  if (pollTimer !== null) globalThis.clearTimeout(pollTimer);
  pollTimer = null;
}

function reset(): void {
  callbackUrl.value = '';
  state.value = null;
  jobId.value = null;
  busy.value = false;
  error.value = null;
  feedback.value = '';
  vaultPassphrase.value = '';
  vaultPassphraseConfirmation.value = '';
  plaintextAcknowledged.value = false;
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="t('admin.credentialAcquisition.title')"
    :description="t('admin.credentialAcquisition.description')"
    size="lg"
    @update:open="requestClose"
  >
    <div class="grid gap-4">
      <AlibabaCredentialAcquisitionSteps :state="state" />

      <div class="rounded-lg border bg-muted/35 p-4 text-sm leading-6">
        <p class="font-medium">{{ t('admin.credentialAcquisition.existingApplicationTitle') }}</p>
        <p class="mt-1 text-muted-foreground">
          {{ t('admin.credentialAcquisition.existingApplicationDescription') }}
        </p>
      </div>

      <template v-if="state === null">
        <label class="text-sm font-medium">
          {{ t('admin.credentialAcquisition.callbackLabel') }}
          <Input
            v-model="callbackUrl"
            class="mt-2"
            type="url"
            :placeholder="t('admin.credentialAcquisition.callbackPlaceholder')"
            autocomplete="off"
          />
        </label>
        <p class="text-xs leading-5 text-muted-foreground">
          {{ t('admin.credentialAcquisition.callbackNotice') }}
        </p>
        <Button :disabled="busy || !alibabaCredentialAcquisition" @click="start">
          <ExternalLink class="size-4" />{{ t('admin.credentialAcquisition.start') }}
        </Button>
      </template>

      <div v-else-if="state.status === 'running'" class="rounded-lg border p-5 text-center">
        <LoaderCircle class="mx-auto size-7 animate-spin text-primary" />
        <p class="mt-3 font-medium">{{ t('admin.credentialAcquisition.waitingTitle') }}</p>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          {{ t('admin.credentialAcquisition.waitingDescription') }}
        </p>
        <Button class="mt-4" variant="outline" :disabled="busy" @click="refreshStatus">
          {{ t('admin.credentialAcquisition.checkNow') }}
        </Button>
      </div>

      <AlibabaCredentialPrerequisiteGuide
        v-else-if="state.status === 'prerequisite-required'"
        :state="state"
        :busy="busy"
        can-locate
        @locate="locatePrerequisiteField"
        @open-page="focusPrerequisitePage"
        @recheck="start"
      />

      <div v-else-if="state.status === 'selection-required'" class="grid gap-3">
        <div>
          <h3 class="font-medium">{{ t('admin.credentialAcquisition.selectApplication') }}</h3>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ t('admin.credentialAcquisition.selectApplicationDescription') }}
          </p>
        </div>
        <button
          v-for="application in state.applications"
          :key="application.applicationId"
          type="button"
          class="cursor-pointer rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-accent"
          :disabled="busy"
          @click="selectApplication(application.applicationId)"
        >
          <span class="font-medium">{{ application.appName }}</span>
          <span class="mt-1 block text-xs text-muted-foreground">
            {{
              t('admin.credentialAcquisition.applicationSummary', {
                source: application.source,
                suffix: application.appKeySuffix,
                status: application.status || t('admin.credentialAcquisition.unknownStatus')
              })
            }}
          </span>
        </button>
      </div>

      <div v-else-if="state.status === 'callback-confirmation-required'" class="grid gap-4">
        <div class="rounded-lg border p-4 text-sm leading-6">
          <p class="font-medium">
            {{
              callbackChanged
                ? t('admin.credentialAcquisition.callbackChangeTitle')
                : t('admin.credentialAcquisition.callbackOAuthTitle')
            }}
          </p>
          <dl class="mt-3 grid gap-2 text-xs">
            <div>
              <dt class="text-muted-foreground">{{ t('admin.credentialAcquisition.currentUrl') }}</dt>
              <dd class="break-all font-mono">{{ state.currentUrl }}</dd>
            </div>
            <div v-if="callbackChanged">
              <dt class="text-muted-foreground">{{ t('admin.credentialAcquisition.requestedUrl') }}</dt>
              <dd class="break-all font-mono">{{ state.requestedUrl }}</dd>
            </div>
          </dl>
        </div>
        <p class="text-xs leading-5 text-muted-foreground">
          {{ t('admin.credentialAcquisition.callbackPermissionNotice') }}
        </p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button v-if="callbackChanged" variant="outline" :disabled="busy" @click="confirmCallback(false)">
            {{ t('admin.credentialAcquisition.keepCallback') }}
          </Button>
          <Button :disabled="busy" @click="confirmCallback(callbackChanged)">
            {{
              callbackChanged
                ? t('admin.credentialAcquisition.confirmCallback')
                : t('admin.credentialAcquisition.continueAuthorization')
            }}
          </Button>
        </div>
      </div>

      <div v-else-if="state.status === 'completed'" class="grid gap-4">
        <div
          class="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
        >
          <div class="flex items-start gap-3">
            <CheckCircle2 class="mt-0.5 size-5 shrink-0" />
            <div>
              <p class="font-medium">{{ t('admin.credentialAcquisition.completedTitle') }}</p>
              <p class="mt-1 text-sm">
                {{
                  t('admin.credentialAcquisition.completedSummary', {
                    appName: completed?.appName ?? '',
                    suffix: completed?.appKeySuffix ?? '',
                    count: completed?.permissions.total ?? 0
                  })
                }}
              </p>
            </div>
          </div>
        </div>

        <div class="rounded-lg border p-4">
          <div class="flex items-center gap-2">
            <KeyRound class="size-4 text-primary" />
            <h3 class="font-medium">{{ t('admin.credentialAcquisition.saveToExtension') }}</h3>
          </div>
          <p v-if="vaultStatus?.state === 'locked'" class="mt-2 text-sm text-amber-700 dark:text-amber-300">
            {{ t('admin.credentialAcquisition.vaultLocked') }}
          </p>
          <div v-else-if="vaultStatus?.state === 'empty'" class="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              v-model="vaultPassphrase"
              type="password"
              autocomplete="new-password"
              :placeholder="t('admin.credentialAcquisition.passphrasePlaceholder')"
            />
            <Input
              v-model="vaultPassphraseConfirmation"
              type="password"
              autocomplete="new-password"
              :placeholder="t('admin.credentialAcquisition.passphraseConfirmationPlaceholder')"
            />
          </div>
          <Button
            class="mt-3"
            :disabled="busy || vaultStatus?.state === 'locked' || vaultStatus?.state === 'invalid'"
            @click="saveToVault"
          >
            <Save class="size-4" />{{ t('admin.credentialAcquisition.saveEncrypted') }}
          </Button>
        </div>

        <div
          class="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/25"
        >
          <div class="flex items-start gap-2">
            <ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium">{{ t('admin.credentialAcquisition.plaintextTitle') }}</p>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ t('admin.credentialAcquisition.plaintextDescription') }}
              </p>
              <label class="mt-3 flex cursor-pointer items-start gap-2 text-xs">
                <input v-model="plaintextAcknowledged" class="mt-0.5" type="checkbox" />
                <span>{{ t('admin.credentialAcquisition.plaintextAcknowledgement') }}</span>
              </label>
              <Button
                class="mt-3"
                variant="outline"
                :disabled="busy || !plaintextAcknowledged"
                @click="exportCredentialBundle"
              >
                <Download class="size-4" />{{ t('admin.credentialAcquisition.exportPlaintext') }}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="state.status === 'failed'" class="grid gap-3">
        <ErrorNotice
          :error="state.error"
          :fallback="t('admin.credentialAcquisition.errors.acquisition')"
          compact
        />
        <Button variant="outline" @click="reset">{{ t('admin.credentialAcquisition.restart') }}</Button>
      </div>

      <div v-else-if="state.status === 'extension-required'" class="rounded-lg border p-4 text-sm">
        {{ t('admin.credentialAcquisition.extensionRequired', { reason: state.reasonCode }) }}
      </div>

      <p
        v-if="feedback"
        class="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
      >
        {{ feedback }}
      </p>
      <ErrorNotice
        v-if="error"
        :error="error"
        :fallback="t('admin.credentialAcquisition.errors.operation')"
        compact
      />
    </div>

    <template #footer>
      <div class="flex justify-end">
        <Button variant="outline" :disabled="busy" @click="requestClose">
          {{ t('admin.credentialAcquisition.close') }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
