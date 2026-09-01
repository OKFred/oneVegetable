<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import {
  AlertTriangle,
  Database,
  Download,
  ExternalLink,
  FileUp,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
  WandSparkles
} from '@lucide/vue';
import { toast } from 'vue-sonner';

import {
  ALIBABA_GATEWAY,
  CREDENTIAL_VAULT_DEFAULT_IDLE_TIMEOUT_MINUTES,
  CREDENTIAL_VAULT_IDLE_TIMEOUT_OPTIONS,
  CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS,
  validateVaultPassphrase,
  type CredentialVaultStatus,
  type DiagnosticsSnapshot,
  type GatewaySettings,
  type LocalDataCategory,
  type LocalDataInventory,
  type SignMethod
} from '@one-vegetable/core';

import ActionTooltip from '../components/ActionTooltip.vue';
import AlibabaCredentialAcquisitionDialog from '../components/AlibabaCredentialAcquisitionDialog.vue';
import ConfirmActionDialog from '../components/ConfirmActionDialog.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import ExtensionSocialBackendPanel from '../components/ExtensionSocialBackendPanel.vue';
import PageHeader from '../components/PageHeader.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useUiI18n } from '../i18n';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import type { DataColumn } from '../lib/table';

const {
  gateway,
  settings,
  permissions,
  localData,
  vault,
  alibabaCredentialAcquisition,
  extensionSocialBackend,
  mode
} = useServices();
const { t } = useUiI18n();
const { alibabaLanguage: preferredLanguage } = useAppPreferences();
const signMethods: SignMethod[] = ['hmac', 'md5', 'hmac-sha256'];
const model = ref<GatewaySettings>({
  appKey: '',
  appSecret: '',
  accessToken: '',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac'
});
const saving = ref(false);
const feedback = ref('');
const diagnostics = ref<DiagnosticsSnapshot | null>(null);
const diagnosticsBusy = ref(false);
const diagnosticsError = ref<unknown>(null);
const grantedHosts = ref<string[]>([]);
const permissionsBusy = ref(false);
const permissionsError = ref<unknown>(null);
const dataInventory = ref<LocalDataInventory | null>(null);
const dataBusy = ref(false);
const dataError = ref<unknown>(null);
const clearConfirmation = ref('');
const vaultStatus = ref<CredentialVaultStatus | null>(null);
const vaultPassphrase = ref('');
const vaultPassphraseConfirmation = ref('');
const newVaultPassphrase = ref('');
const newVaultPassphraseConfirmation = ref('');
const vaultBusy = ref(false);
const vaultError = ref<unknown>(null);
const credentialImportError = ref<unknown>(null);
const credentialAcquisitionOpen = ref(false);
const idleTimeoutMinutes = ref(CREDENTIAL_VAULT_DEFAULT_IDLE_TIMEOUT_MINUTES);
let settingsInitialization: Promise<void> = Promise.resolve();
const settingsConfirmation = ref<
  { kind: 'revoke-permission'; origin: string } | { kind: 'clear-diagnostics' } | null
>(null);
const settingsConfirmationTitle = computed(() =>
  settingsConfirmation.value?.kind === 'revoke-permission'
    ? t('settings.confirmation.revokeTitle')
    : t('settings.confirmation.clearDiagnosticsTitle')
);
const settingsConfirmationDescription = computed(() => {
  const confirmation = settingsConfirmation.value;
  if (!confirmation) return '';
  return confirmation.kind === 'revoke-permission'
    ? t('settings.confirmation.revokeDescription', { origin: confirmation.origin })
    : t('settings.confirmation.clearDiagnosticsDescription', {
        count: diagnostics.value?.entries.length ?? 0
      });
});
const clearDiagnosticsDisabledReason = computed(() => {
  if (diagnosticsBusy.value) return t('settings.diagnostics.busy');
  if ((diagnostics.value?.entries.length ?? 0) === 0) return t('settings.diagnostics.emptyDisabled');
  return '';
});
const settingsEditable = computed(
  () => mode === 'mock' || vaultStatus.value?.state === 'empty' || vaultStatus.value?.state === 'unlocked'
);
const lastDiagnosticError = computed(() =>
  diagnostics.value?.entries.findLast((entry) => entry.outcome === 'error')
);
const vaultActivitySummary = computed(() => {
  const status = vaultStatus.value;
  if (!status?.lastActivityAt || status.idleRemainingSeconds === null) return '';
  const lastActivity = formatDateTime(status.lastActivityAt);
  const remainingMinutes = Math.max(1, Math.ceil(status.idleRemainingSeconds / 60));
  return t('settings.vault.activity', { time: lastActivity, minutes: remainingMinutes });
});
const clearPhrase = computed(() => t('settings.localData.clearPhrase'));

const localDataColumns = computed<DataColumn<LocalDataCategory>[]>(() => [
  {
    accessorKey: 'label',
    header: t('settings.localData.columns.category'),
    cell: ({ row }) =>
      h('span', [
        row.original.label,
        row.original.sensitive
          ? h(
              'span',
              { class: 'ml-1 text-xs text-amber-700 dark:text-amber-400' },
              t('settings.localData.sensitive')
            )
          : null
      ])
  },
  {
    accessorKey: 'storage',
    header: t('settings.localData.columns.storage'),
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.storage)
  },
  { accessorKey: 'itemCount', header: t('settings.localData.columns.count') },
  {
    accessorKey: 'approximateBytes',
    header: t('settings.localData.columns.size'),
    cell: ({ row }) => formatBytes(row.original.approximateBytes)
  },
  {
    accessorKey: 'retention',
    header: t('settings.localData.columns.retention'),
    cell: ({ row }) => h('span', { class: 'text-xs text-muted-foreground' }, row.original.retention)
  }
]);

onMounted(async () => {
  settingsInitialization = initializeView();
  await settingsInitialization;
});

async function initializeView(): Promise<void> {
  const [, , , storedSettings] = await Promise.all([
    refreshDiagnostics(),
    refreshPermissions(),
    refreshLocalData(),
    initializeSettings()
  ]);
  if (storedSettings) model.value = storedSettings;
}

async function initializeSettings(): Promise<GatewaySettings | undefined> {
  if (mode !== 'extension' || !vault) return settings.load();
  await refreshVaultStatus();
  if (vaultStatus.value?.state === 'locked' || vaultStatus.value?.state === 'invalid') return undefined;
  return settings.load();
}

async function save(): Promise<void> {
  saving.value = true;
  feedback.value = '';
  vaultError.value = null;
  try {
    if (mode === 'extension' && vault && vaultStatus.value?.state === 'empty') {
      assertMatchingPassphrases(vaultPassphrase.value, vaultPassphraseConfirmation.value);
      applyVaultStatus(await vault.create(vaultPassphrase.value, model.value));
      clearVaultPassphrases();
      model.value = await settings.load();
      feedback.value = t('settings.vault.saveEncrypted');
      toast.success(t('settings.vault.savedToast'));
      await refreshLocalData();
    } else {
      await settings.save(model.value);
      feedback.value =
        mode === 'mock'
          ? t('settings.credentials.mockSavedFeedback')
          : t('settings.credentials.encryptedSavedFeedback');
      model.value = await settings.load();
      toast.success(
        mode === 'mock' ? t('settings.credentials.mockSavedToast') : t('settings.credentials.savedToast')
      );
    }
  } catch (error: unknown) {
    const visibleError = userVisibleCause(error, t('settings.credentials.saveError'));
    vaultError.value = visibleError;
    toast.error(visibleError.message);
  } finally {
    saving.value = false;
  }
}

async function importCredentialBundle(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  feedback.value = '';
  credentialImportError.value = null;
  try {
    await settingsInitialization;
    if (file.size > 256 * 1024) throw new Error(t('settings.credentials.bundleTooLarge'));
    const imported = readImportedCredentials(JSON.parse(await file.text()) as unknown);
    model.value = { ...model.value, ...imported };
    feedback.value = t('settings.credentials.bundleLoaded');
  } catch (error: unknown) {
    credentialImportError.value = userVisibleCause(error, t('settings.credentials.bundleImportError'));
  } finally {
    input.value = '';
  }
}

async function handleAcquiredCredentialsSaved(status: CredentialVaultStatus): Promise<void> {
  applyVaultStatus(status);
  model.value = await settings.load();
  feedback.value = t('settings.credentials.acquired');
  await refreshLocalData();
}

function readImportedCredentials(
  value: unknown
): Pick<GatewaySettings, 'appKey' | 'appSecret' | 'accessToken'> {
  const root = objectValue(value);
  const application = objectValue(root.application);
  const oauth = objectValue(root.oauth);
  const appKey = importedString(root.appKey) ?? importedString(application.appKey);
  const appSecret = importedString(root.appSecret) ?? importedString(application.appSecret);
  const accessToken = importedString(root.accessToken) ?? importedString(oauth.accessToken);
  if (!appKey || !appSecret || !accessToken) {
    throw new Error(t('settings.credentials.bundleMissing'));
  }
  return { appKey, appSecret, accessToken };
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function importedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function refreshVaultStatus(): Promise<void> {
  if (!vault) return;
  vaultError.value = null;
  try {
    applyVaultStatus(await vault.status());
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, t('settings.vault.statusError'));
  }
}

async function unlockVault(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = null;
  try {
    applyVaultStatus(await vault.unlock(vaultPassphrase.value));
    model.value = await settings.load();
    clearVaultPassphrases();
    feedback.value = t('settings.vault.unlockedFeedback');
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, t('settings.vault.unlockError'));
  } finally {
    vaultBusy.value = false;
  }
}

async function migrateVault(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = null;
  try {
    assertMatchingPassphrases(vaultPassphrase.value, vaultPassphraseConfirmation.value);
    applyVaultStatus(await vault.migrate(vaultPassphrase.value));
    model.value = await settings.load();
    clearVaultPassphrases();
    feedback.value = t('settings.vault.migratedFeedback');
    await refreshLocalData();
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, t('settings.vault.migrateError'));
  } finally {
    vaultBusy.value = false;
  }
}

async function lockVault(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  try {
    applyVaultStatus(await vault.lock());
    model.value = {
      appKey: '',
      appSecret: '',
      accessToken: '',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac'
    };
    feedback.value = t('settings.vault.lockedFeedback');
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, t('settings.vault.lockError'));
  } finally {
    vaultBusy.value = false;
  }
}

async function rotateVaultPassphrase(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = null;
  try {
    assertMatchingPassphrases(newVaultPassphrase.value, newVaultPassphraseConfirmation.value);
    applyVaultStatus(await vault.rotate(newVaultPassphrase.value));
    clearVaultPassphrases();
    feedback.value = t('settings.vault.rotatedFeedback');
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, t('settings.vault.rotateError'));
  } finally {
    vaultBusy.value = false;
  }
}

async function updateVaultPolicy(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = null;
  try {
    applyVaultStatus(await vault.updatePolicy(idleTimeoutMinutes.value));
    feedback.value =
      idleTimeoutMinutes.value === 0
        ? t('settings.vault.idleDisabledFeedback')
        : t('settings.vault.idleEnabledFeedback', { minutes: idleTimeoutMinutes.value });
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, t('settings.vault.policyError'));
  } finally {
    vaultBusy.value = false;
  }
}

function applyVaultStatus(status: CredentialVaultStatus): void {
  vaultStatus.value = status;
  if (status.idleTimeoutMinutes !== null) idleTimeoutMinutes.value = status.idleTimeoutMinutes;
}

function assertMatchingPassphrases(passphrase: string, confirmation: string): void {
  validateVaultPassphrase(passphrase);
  if (passphrase !== confirmation) throw new Error(t('settings.vault.mismatchError'));
}

function clearVaultPassphrases(): void {
  vaultPassphrase.value = '';
  vaultPassphraseConfirmation.value = '';
  newVaultPassphrase.value = '';
  newVaultPassphraseConfirmation.value = '';
}

async function refreshPermissions(): Promise<void> {
  if (!permissions) return;
  permissionsBusy.value = true;
  permissionsError.value = null;
  try {
    grantedHosts.value = await permissions.list();
  } catch (error: unknown) {
    permissionsError.value = userVisibleCause(error, t('settings.permissions.loadError'));
  } finally {
    permissionsBusy.value = false;
  }
}

async function revokePermission(origin: string): Promise<void> {
  if (!permissions) return;
  permissionsBusy.value = true;
  permissionsError.value = null;
  try {
    const removed = await permissions.revoke(origin);
    await refreshPermissions();
    feedback.value = removed
      ? t('settings.permissions.revoked', { origin })
      : t('settings.permissions.notGranted', { origin });
  } catch (error: unknown) {
    permissionsError.value = userVisibleCause(error, t('settings.permissions.revokeError'));
  } finally {
    permissionsBusy.value = false;
  }
}

async function refreshDiagnostics(): Promise<void> {
  diagnosticsBusy.value = true;
  diagnosticsError.value = null;
  try {
    diagnostics.value = await gateway.request('getDiagnostics', undefined);
  } catch (error: unknown) {
    diagnosticsError.value = userVisibleCause(error, t('settings.diagnostics.loadError'));
  } finally {
    diagnosticsBusy.value = false;
  }
}

async function exportDiagnostics(): Promise<void> {
  await refreshDiagnostics();
  if (!diagnostics.value) return;
  const blob = new Blob([JSON.stringify(diagnostics.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = `one-vegetable-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  feedback.value = t('settings.diagnostics.exported', { count: diagnostics.value.entries.length });
}

async function clearDiagnostics(): Promise<void> {
  diagnosticsBusy.value = true;
  diagnosticsError.value = null;
  try {
    await gateway.request('clearDiagnostics', undefined);
    diagnostics.value = await gateway.request('getDiagnostics', undefined);
    feedback.value = t('settings.diagnostics.cleared');
  } catch (error: unknown) {
    diagnosticsError.value = userVisibleCause(error, t('settings.diagnostics.clearError'));
  } finally {
    diagnosticsBusy.value = false;
  }
}

function confirmSettingsAction(): void {
  const confirmation = settingsConfirmation.value;
  settingsConfirmation.value = null;
  if (!confirmation) return;
  if (confirmation.kind === 'revoke-permission') {
    void revokePermission(confirmation.origin);
    return;
  }
  void clearDiagnostics();
}

async function refreshLocalData(): Promise<void> {
  if (!localData) return;
  dataBusy.value = true;
  dataError.value = null;
  try {
    dataInventory.value = await localData.inspect();
  } catch (error: unknown) {
    dataError.value = userVisibleCause(error, t('settings.localData.loadError'));
  } finally {
    dataBusy.value = false;
  }
}

async function exportLocalDataInventory(): Promise<void> {
  await refreshLocalData();
  if (!dataInventory.value) return;
  downloadJson(
    dataInventory.value,
    `one-vegetable-local-data-inventory-${new Date().toISOString().slice(0, 10)}.json`
  );
  feedback.value = t('settings.localData.exported');
}

async function clearAllLocalData(): Promise<void> {
  if (!localData || clearConfirmation.value !== clearPhrase.value) return;
  dataBusy.value = true;
  dataError.value = null;
  try {
    await localData.clearAll();
    clearConfirmation.value = '';
    model.value = {
      appKey: '',
      appSecret: '',
      accessToken: '',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac'
    };
    await Promise.all([refreshLocalData(), refreshDiagnostics(), refreshPermissions()]);
    feedback.value = t('settings.localData.cleared');
  } catch (error: unknown) {
    dataError.value = userVisibleCause(error, t('settings.localData.clearError'));
  } finally {
    dataBusy.value = false;
  }
}

function userVisibleCause(cause: unknown, fallbackMessage: string): Error {
  return cause instanceof Error ? cause : new Error(fallbackMessage);
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function confirmLanguagePreference(): void {
  feedback.value = t('settings.alibabaLanguage.saved', { language: preferredLanguage.value });
}
</script>

<template>
  <PageHeader :title="t('settings.page.title')" :description="t('settings.page.description')" />
  <div class="grid max-w-3xl gap-4">
    <p
      v-if="feedback"
      class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
    >
      {{ feedback }}
    </p>
    <Card v-if="mode === 'extension' && vault" class="p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <LockKeyhole class="size-4 text-primary" />
            <h2 class="font-semibold">{{ t('settings.vault.title') }}</h2>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ t('settings.vault.description') }}
          </p>
        </div>
        <span class="rounded-full bg-muted px-3 py-1 text-xs">
          {{
            vaultStatus === null
              ? t('settings.vault.status.loading')
              : vaultStatus.state === 'unlocked'
                ? t('settings.vault.status.unlocked')
                : vaultStatus.state === 'legacy'
                  ? t('settings.vault.status.legacy')
                  : vaultStatus.state === 'empty'
                    ? t('settings.vault.status.empty')
                    : vaultStatus.state === 'invalid'
                      ? t('settings.vault.status.invalid')
                      : t('settings.vault.status.locked')
          }}
        </span>
      </div>

      <div v-if="vaultStatus?.state === 'legacy'" class="mt-4 rounded-lg bg-amber-50 p-4 text-amber-900">
        <p class="text-sm font-medium">{{ t('settings.vault.legacyTitle') }}</p>
        <p class="mt-1 text-xs leading-5">
          {{ t('settings.vault.legacyDescription') }}
        </p>
      </div>
      <div v-else-if="vaultStatus?.state === 'locked'" class="mt-4 rounded-lg border p-4">
        <p class="text-sm font-medium">
          {{
            vaultStatus.lockReason === 'idle'
              ? t('settings.vault.lockReason.idle')
              : vaultStatus.lockReason === 'session-ended'
                ? t('settings.vault.lockReason.sessionEnded')
                : t('settings.vault.lockReason.manual')
          }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{
            vaultStatus.lockReason === 'session-ended'
              ? t('settings.vault.lockDescription.sessionEnded')
              : t('settings.vault.lockDescription.other')
          }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Input
            v-model="vaultPassphrase"
            class="max-w-sm"
            type="password"
            :aria-label="t('settings.vault.passphrase')"
            autocomplete="current-password"
          />
          <Button :disabled="vaultBusy || !vaultPassphrase" @click="unlockVault">
            <UnlockKeyhole class="size-4" />{{ t('settings.vault.unlock') }}
          </Button>
        </div>
      </div>
      <div v-else-if="vaultStatus?.state === 'invalid'" class="mt-4 rounded-lg bg-red-50 p-4 text-red-900">
        <p class="text-sm font-medium">{{ t('settings.vault.invalidTitle') }}</p>
        <p class="mt-1 text-xs leading-5">
          {{ t('settings.vault.invalidDescription') }}
        </p>
      </div>
      <div v-else-if="vaultStatus?.state === 'unlocked'" class="mt-4 grid gap-4">
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" :disabled="vaultBusy" @click="lockVault">
            <LockKeyhole class="size-4" />{{ t('settings.vault.lockNow') }}
          </Button>
        </div>
        <div class="rounded-lg border p-4">
          <p class="text-sm font-medium">{{ t('settings.vault.idleTitle') }}</p>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            {{ t('settings.vault.idleDescription') }}
          </p>
          <p v-if="vaultActivitySummary" class="mt-2 text-xs text-muted-foreground">
            {{ vaultActivitySummary }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <select
              v-model.number="idleTimeoutMinutes"
              class="h-9 rounded-md border bg-background px-3 text-sm"
              :aria-label="t('settings.vault.idleLabel')"
            >
              <option
                v-for="minutes in CREDENTIAL_VAULT_IDLE_TIMEOUT_OPTIONS"
                :key="minutes"
                :value="minutes"
              >
                {{ minutes === 0 ? t('settings.vault.neverLock') : t('settings.vault.minutes', { minutes }) }}
              </option>
            </select>
            <Button variant="outline" :disabled="vaultBusy" @click="updateVaultPolicy">{{
              t('settings.vault.savePolicy')
            }}</Button>
          </div>
        </div>
        <div class="rounded-lg border p-4">
          <p class="text-sm font-medium">{{ t('settings.vault.rotateTitle') }}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('settings.vault.rotateDescription') }}
          </p>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              v-model="newVaultPassphrase"
              type="password"
              :aria-label="t('settings.vault.newPassphrase')"
              autocomplete="new-password"
              :placeholder="
                t('settings.vault.minimumCharacters', {
                  count: CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS
                })
              "
            />
            <Input
              v-model="newVaultPassphraseConfirmation"
              type="password"
              :aria-label="t('settings.vault.confirmNewPassphrase')"
              autocomplete="new-password"
              :placeholder="t('settings.vault.enterAgain')"
            />
          </div>
          <Button
            class="mt-3"
            variant="outline"
            :disabled="vaultBusy || !newVaultPassphrase || !newVaultPassphraseConfirmation"
            @click="rotateVaultPassphrase"
          >
            <RotateCcw class="size-4" />{{ t('settings.vault.rotate') }}
          </Button>
        </div>
      </div>

      <div
        v-if="vaultStatus?.state === 'empty' || vaultStatus?.state === 'legacy'"
        class="mt-4 grid gap-2 sm:grid-cols-2"
      >
        <Input
          v-model="vaultPassphrase"
          type="password"
          :aria-label="t('settings.vault.setPassphrase')"
          autocomplete="new-password"
          :placeholder="
            t('settings.vault.minimumCharacters', {
              count: CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS
            })
          "
        />
        <Input
          v-model="vaultPassphraseConfirmation"
          type="password"
          :aria-label="t('settings.vault.confirmPassphrase')"
          autocomplete="new-password"
          :placeholder="t('settings.vault.enterAgain')"
        />
        <Button
          v-if="vaultStatus?.state === 'legacy'"
          class="sm:col-span-2"
          :disabled="vaultBusy || !vaultPassphrase || !vaultPassphraseConfirmation"
          @click="migrateVault"
        >
          <ShieldCheck class="size-4" />{{ t('settings.vault.migrate') }}
        </Button>
      </div>
      <ErrorNotice v-if="vaultError" class="mt-3" :error="vaultError" compact />
    </Card>

    <Card v-if="settingsEditable" class="p-5">
      <div class="mb-4 flex items-center gap-2">
        <KeyRound class="size-4 text-primary" />
        <h2 class="font-semibold">{{ t('settings.credentials.title') }}</h2>
      </div>
      <div class="mb-4 rounded-lg border bg-muted/40 p-4 text-sm leading-6">
        <p class="font-medium">{{ t('settings.credentials.guideTitle') }}</p>
        <p class="mt-1 text-muted-foreground">
          {{ t('settings.credentials.guideDescription') }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button
            v-if="alibabaCredentialAcquisition"
            size="sm"
            type="button"
            @click="credentialAcquisitionOpen = true"
          >
            <WandSparkles class="size-3.5" />{{ t('settings.credentials.acquire') }}
          </Button>
          <a
            href="https://i.alibaba.com/explore/open-api"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            <ExternalLink class="size-3.5" />{{ t('settings.credentials.openCenter') }}
          </a>
          <label
            class="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            <FileUp class="size-3.5" />{{ t('settings.credentials.importBundle') }}
            <input
              class="sr-only"
              type="file"
              accept="application/json,.json"
              :aria-label="t('settings.credentials.importLabel')"
              @change="importCredentialBundle"
            />
          </label>
        </div>
        <ErrorNotice v-if="credentialImportError" class="mt-3" :error="credentialImportError" compact />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium"
          >App Key<Input v-model="model.appKey" class="mt-2" autocomplete="off" aria-label="App Key"
        /></label>
        <label class="text-sm font-medium"
          >App Secret<Input
            v-model="model.appSecret"
            class="mt-2"
            type="password"
            aria-label="App Secret"
            autocomplete="new-password"
            :placeholder="vaultStatus?.hasAppSecret ? t('settings.credentials.encryptedPlaceholder') : ''"
        /></label>
        <label class="text-sm font-medium sm:col-span-2"
          >Access Token<Input
            v-model="model.accessToken"
            class="mt-2"
            type="password"
            aria-label="Access Token"
            autocomplete="new-password"
            :placeholder="vaultStatus?.hasAccessToken ? t('settings.credentials.encryptedPlaceholder') : ''"
        /></label>
        <label class="text-sm font-medium sm:col-span-2"
          >{{ t('settings.credentials.gateway')
          }}<Input v-model="model.endpoint" class="mt-2" :aria-label="t('settings.credentials.gateway')"
        /></label>
        <label class="text-sm font-medium"
          >{{ t('settings.credentials.signMethod')
          }}<select
            v-model="model.signMethod"
            class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option v-for="item in signMethods" :key="item" :value="item">{{ item }}</option>
          </select></label
        >
      </div>
      <Button
        class="mt-4"
        :disabled="
          saving ||
          vaultBusy ||
          (mode === 'extension' &&
            vaultStatus?.state === 'empty' &&
            (!vaultPassphrase || !vaultPassphraseConfirmation))
        "
        @click="save"
      >
        <LoaderCircle v-if="saving" class="size-4 animate-spin" />
        <Save v-else class="size-4" />
        {{ saving ? t('settings.credentials.saving') : t('settings.credentials.save') }}
      </Button>
    </Card>
    <AlibabaCredentialAcquisitionDialog
      v-if="alibabaCredentialAcquisition"
      v-model:open="credentialAcquisitionOpen"
      @saved="handleAcquiredCredentialsSaved"
    />
    <Card class="flex items-start gap-3 border-emerald-200 bg-emerald-50 p-5 text-emerald-900"
      ><ShieldCheck class="mt-0.5 size-5 shrink-0" />
      <div>
        <p class="font-medium">{{ t('settings.security.title') }}</p>
        <p class="mt-1 text-sm leading-6">
          {{ t('settings.security.description') }}
        </p>
      </div></Card
    >
    <ExtensionSocialBackendPanel v-if="mode === 'extension' && extensionSocialBackend" />
    <Card class="p-5">
      <div class="flex items-start gap-3">
        <Globe2 class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold">{{ t('settings.alibabaLanguage.title') }}</h2>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">
            {{ t('settings.alibabaLanguage.description') }}
          </p>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            {{ t('settings.alibabaLanguage.interfaceHint') }}
          </p>
          <label class="mt-3 block max-w-xs text-sm font-medium">
            {{ t('settings.alibabaLanguage.label') }}
            <select
              v-model="preferredLanguage"
              class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
              :aria-label="t('settings.alibabaLanguage.label')"
              @change="confirmLanguagePreference"
            >
              <option value="zh_CN">{{ t('settings.alibabaLanguage.chinese') }}</option>
              <option value="en_US">{{ t('settings.alibabaLanguage.english') }}</option>
            </select>
          </label>
        </div>
      </div>
    </Card>
    <Card v-if="mode === 'extension' && permissions" class="p-5">
      <div class="flex items-center gap-2">
        <Globe2 class="size-4 text-primary" />
        <h2 class="font-semibold">{{ t('settings.permissions.title') }}</h2>
      </div>
      <p class="mt-2 text-sm text-muted-foreground">
        {{ t('settings.permissions.description') }}
      </p>
      <ErrorNotice v-if="permissionsError" class="mt-3" :error="permissionsError" compact />
      <p v-else-if="grantedHosts.length === 0" class="mt-3 text-sm text-muted-foreground">
        {{ t('settings.permissions.empty') }}
      </p>
      <ul v-else class="mt-3 grid gap-2">
        <li
          v-for="origin in grantedHosts"
          :key="origin"
          class="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
        >
          <code class="break-all text-xs">{{ origin }}</code>
          <Button
            size="sm"
            variant="outline"
            :aria-label="t('settings.permissions.revokeLabel', { origin })"
            :disabled="permissionsBusy"
            @click="settingsConfirmation = { kind: 'revoke-permission', origin }"
          >
            <Trash2 class="size-3.5" />{{ t('settings.permissions.revoke') }}
          </Button>
        </li>
      </ul>
      <Button class="mt-3" variant="outline" :disabled="permissionsBusy" @click="refreshPermissions">
        <RotateCcw class="size-4" />{{ t('settings.permissions.refresh') }}
      </Button>
    </Card>
    <Card class="p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <ShieldCheck class="size-4 text-primary" />
            <h2 class="font-semibold">{{ t('settings.diagnostics.title') }}</h2>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ t('settings.diagnostics.description') }}
          </p>
        </div>
        <span
          :aria-label="t('settings.diagnostics.countLabel')"
          class="rounded-full bg-muted px-3 py-1 text-xs"
        >
          {{ t('settings.diagnostics.count', { count: diagnostics?.entries.length ?? 0 }) }}
        </span>
      </div>
      <div v-if="lastDiagnosticError" class="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
        {{ t('settings.diagnostics.latestError') }} {{ lastDiagnosticError.errorCode }} ·
        {{ lastDiagnosticError.operation }} ·
        {{ lastDiagnosticError.errorMessage }}
        <span class="mt-1 block break-all font-mono text-[11px]">
          requestId：{{ lastDiagnosticError.requestId }}
        </span>
      </div>
      <ErrorNotice v-if="diagnosticsError" class="mt-3" :error="diagnosticsError" compact />
      <div class="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" :disabled="diagnosticsBusy" @click="refreshDiagnostics">
          <RotateCcw class="size-4" />{{ t('settings.diagnostics.refresh') }}
        </Button>
        <Button variant="outline" :disabled="diagnosticsBusy" @click="exportDiagnostics">
          <Download class="size-4" />{{ t('settings.diagnostics.export') }}
        </Button>
        <ActionTooltip
          :disabled="Boolean(clearDiagnosticsDisabledReason)"
          :reason="clearDiagnosticsDisabledReason"
        >
          <Button
            variant="outline"
            :disabled="Boolean(clearDiagnosticsDisabledReason)"
            @click="settingsConfirmation = { kind: 'clear-diagnostics' }"
          >
            <Trash2 class="size-4" />{{ t('settings.diagnostics.clear') }}
          </Button>
        </ActionTooltip>
      </div>
    </Card>
    <Card v-if="mode === 'extension' && localData" class="p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <Database class="size-4 text-primary" />
            <h2 class="font-semibold">{{ t('settings.localData.title') }}</h2>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ t('settings.localData.description') }}
          </p>
        </div>
        <span class="rounded-full bg-muted px-3 py-1 text-xs">
          {{ formatBytes(dataInventory?.totalApproximateBytes ?? 0) }}
        </span>
      </div>
      <ErrorNotice v-if="dataError" class="mt-3" :error="dataError" compact />
      <DataTable
        class="mt-4"
        :columns="localDataColumns"
        :data="dataInventory?.categories ?? []"
        max-height="min(60vh, 36rem)"
        min-width="620px"
        :empty-text="t('settings.localData.empty')"
      />
      <div class="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" :disabled="dataBusy" @click="refreshLocalData">
          <RotateCcw class="size-4" />{{ t('settings.localData.refresh') }}
        </Button>
        <Button variant="outline" :disabled="dataBusy" @click="exportLocalDataInventory">
          <Download class="size-4" />{{ t('settings.localData.export') }}
        </Button>
      </div>
      <div class="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
        <div class="flex items-start gap-2 text-red-900">
          <AlertTriangle class="mt-0.5 size-4 shrink-0" />
          <div>
            <p class="text-sm font-medium">{{ t('settings.localData.dangerTitle') }}</p>
            <p class="mt-1 text-xs leading-5">
              {{ t('settings.localData.dangerDescription', { phrase: clearPhrase }) }}
            </p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <Input
            v-model="clearConfirmation"
            class="max-w-xs bg-white"
            :aria-label="t('settings.localData.clearLabel')"
            autocomplete="off"
            :placeholder="clearPhrase"
          />
          <Button
            variant="outline"
            class="border-red-300 text-red-800 hover:bg-red-100"
            :disabled="dataBusy || clearConfirmation !== clearPhrase"
            @click="clearAllLocalData"
          >
            <Trash2 class="size-4" />{{ t('settings.localData.clear') }}
          </Button>
        </div>
      </div>
    </Card>
  </div>

  <ConfirmActionDialog
    :open="settingsConfirmation !== null"
    :title="settingsConfirmationTitle"
    :description="settingsConfirmationDescription"
    destructive
    :confirm-label="t('settings.confirmation.continue')"
    @update:open="settingsConfirmation = $event ? settingsConfirmation : null"
    @confirm="confirmSettingsAction"
  >
    <p v-if="settingsConfirmation?.kind === 'clear-diagnostics'">
      {{ t('settings.confirmation.clearDiagnosticsDetail') }}
    </p>
    <p v-else>{{ t('settings.confirmation.revokeDetail') }}</p>
  </ConfirmActionDialog>
</template>
