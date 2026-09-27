<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import {
  Database,
  ExternalLink,
  FileUp,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
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
  type GatewaySettings,
  type SignMethod
} from '@one-vegetable/core';

import AlibabaCredentialAcquisitionDialog from '../components/AlibabaCredentialAcquisitionDialog.vue';
import AlibabaIndependentNotice from '../components/AlibabaIndependentNotice.vue';
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
import { useUnsavedEditing, VAULT_UNLOCKED_EVENT } from '../lib/unsaved-editing';

const {
  settings,
  vault,
  alibabaCredentialAcquisition,
  extensionSocialBackend,
  control,
  s3Storage,
  runtime,
  mode
} = useServices();
const { t } = useUiI18n();
const activeSection = ref('credentials');
const sections = computed(() => [
  { id: 'credentials', icon: KeyRound },
  ...((mode === 'bff' && control) || s3Storage ? [{ id: 'storage', icon: Database }] : []),
  { id: 'preferences', icon: Globe2 }
]);
const S3StorageSettingsPanel = defineAsyncComponent(() => import('../components/S3StorageSettingsPanel.vue'));
const GatewayCredentialPanel = defineAsyncComponent(() => import('../components/GatewayCredentialPanel.vue'));
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
const settingsLoaded = ref(false);
const credentialEditing = useUnsavedEditing(() => model.value, { enabled: () => settingsLoaded.value });
const policyEditing = useUnsavedEditing(
  () => ({
    idleTimeoutMinutes: idleTimeoutMinutes.value,
    newPassphrase: newVaultPassphrase.value,
    confirmation: newVaultPassphraseConfirmation.value
  }),
  { enabled: () => settingsLoaded.value }
);
let settingsInitialization: Promise<void> = Promise.resolve();
const settingsEditable = computed(
  () =>
    settingsLoaded.value &&
    (mode === 'mock' || vaultStatus.value?.state === 'empty' || vaultStatus.value?.state === 'unlocked')
);
const vaultActivitySummary = computed(() => {
  const status = vaultStatus.value;
  if (!status?.lastActivityAt || status.idleRemainingSeconds === null) return '';
  const lastActivity = formatDateTime(status.lastActivityAt);
  const remainingMinutes = Math.max(1, Math.ceil(status.idleRemainingSeconds / 60));
  return t('settings.vault.activity', { time: lastActivity, minutes: remainingMinutes });
});
onMounted(async () => {
  settingsInitialization = initializeView();
  await settingsInitialization;
});

async function initializeView(): Promise<void> {
  const storedSettings = await initializeSettings();
  if (storedSettings) model.value = storedSettings;
  credentialEditing.markClean();
  policyEditing.markClean();
  settingsLoaded.value = true;
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
      credentialEditing.markClean();
      feedback.value = t('settings.vault.saveEncrypted');
      toast.success(t('settings.vault.savedToast'));
    } else {
      await settings.save(model.value);
      model.value = await settings.load();
      credentialEditing.markClean();
      feedback.value =
        mode === 'mock'
          ? t('settings.credentials.mockSavedFeedback')
          : t('settings.credentials.encryptedSavedFeedback');
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
    if (!(await credentialEditing.confirmLeave())) return;
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
  credentialEditing.markClean();
  feedback.value = t('settings.credentials.acquired');
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
    credentialEditing.markClean();
    policyEditing.markClean();
    feedback.value = t('settings.vault.unlockedFeedback');
    toast.success(t('settings.vault.unlockedFeedback'));
    globalThis.dispatchEvent(new Event(VAULT_UNLOCKED_EVENT));
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
    credentialEditing.markClean();
    policyEditing.markClean();
    feedback.value = t('settings.vault.migratedFeedback');
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, t('settings.vault.migrateError'));
  } finally {
    vaultBusy.value = false;
  }
}

async function lockVault(): Promise<void> {
  if (!vault) return;
  if (!(await credentialEditing.confirmLeave())) return;
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
    credentialEditing.markClean();
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
    policyEditing.markClean();
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
    policyEditing.markClean();
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

function userVisibleCause(cause: unknown, fallbackMessage: string): Error {
  return cause instanceof Error ? cause : new Error(fallbackMessage);
}

function confirmLanguagePreference(): void {
  feedback.value = t('settings.alibabaLanguage.saved', { language: preferredLanguage.value });
}
</script>

<template>
  <PageHeader :title="t('settings.page.title')" :description="t('settings.page.description')" />
  <div class="grid min-w-0 max-w-7xl items-start gap-5 lg:grid-cols-[11rem_minmax(0,1fr)]">
    <nav
      :aria-label="t('settings.page.title')"
      class="grid grid-cols-2 gap-1 rounded-xl border bg-card p-2 lg:sticky lg:top-5 lg:grid-cols-1"
    >
      <button
        v-for="section in sections"
        :key="section.id"
        type="button"
        :aria-pressed="activeSection === section.id"
        :aria-controls="`settings-${section.id}`"
        class="flex min-w-0 items-center gap-2 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="activeSection === section.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground'"
        @click="activeSection = section.id"
      >
        <component :is="section.icon" class="size-4 shrink-0" />
        {{ t(`settings.sections.${section.id}`) }}
      </button>
    </nav>
    <div class="min-w-0 space-y-4">
      <p
        v-if="feedback"
        class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
      >
        {{ feedback }}
      </p>
      <section
        id="settings-credentials"
        v-show="activeSection === 'credentials'"
        class="min-w-0 space-y-4"
        :aria-label="t('settings.sections.credentials')"
      >
        <GatewayCredentialPanel v-if="mode === 'bff' && runtime?.backendMeta?.runtime === 'node'" />
        <Card v-else-if="mode === 'bff'" class="space-y-3 p-5" data-testid="bff-credential-guide">
          <h2 class="flex items-center gap-2 font-semibold">
            <KeyRound class="size-4 text-primary" />{{ t('settings.credentials.title') }}
          </h2>
          <p class="text-sm text-muted-foreground">{{ t('settings.bffCredentials.boundary') }}</p>
          <template v-if="runtime?.backendMeta?.runtime === 'cloudflare'">
            <p class="text-sm">{{ t('settings.bffCredentials.cloud') }}</p>
            <a href="#/admin" class="inline-block text-sm text-primary hover:underline">{{
              t('settings.bffCredentials.admin')
            }}</a>
          </template>
          <a
            href="https://i.alibaba.com/explore/open-api"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            ><ExternalLink class="size-4" />{{ t('settings.credentials.openCenter') }}</a
          >
        </Card>
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
          <div
            v-else-if="vaultStatus?.state === 'invalid'"
            class="mt-4 rounded-lg bg-red-50 p-4 text-red-900"
          >
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
                    {{
                      minutes === 0 ? t('settings.vault.neverLock') : t('settings.vault.minutes', { minutes })
                    }}
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
          <AlibabaIndependentNotice class="mb-4" />
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
              >App Key<Input
                v-model="model.appKey"
                class="mt-2"
                autocomplete="off"
                aria-label="App Key"
                data-feedback-redact
            /></label>
            <label class="text-sm font-medium"
              >App Secret<Input
                v-model="model.appSecret"
                class="mt-2"
                type="password"
                aria-label="App Secret"
                autocomplete="new-password"
                :placeholder="
                  vaultStatus?.hasAppSecret ? t('settings.credentials.encryptedPlaceholder') : ''
                "
            /></label>
            <label class="text-sm font-medium sm:col-span-2"
              >Access Token<Input
                v-model="model.accessToken"
                class="mt-2"
                type="password"
                aria-label="Access Token"
                autocomplete="new-password"
                :placeholder="
                  vaultStatus?.hasAccessToken ? t('settings.credentials.encryptedPlaceholder') : ''
                "
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
        <Card class="flex items-start gap-3 p-5 text-muted-foreground"
          ><ShieldCheck class="mt-0.5 size-5 shrink-0" />
          <div>
            <p class="font-medium">{{ t('settings.security.title') }}</p>
            <p class="mt-1 text-sm leading-6">
              {{ t('settings.security.description') }}
            </p>
          </div></Card
        >
      </section>
      <section
        v-if="(mode === 'bff' && control) || s3Storage"
        id="settings-storage"
        v-show="activeSection === 'storage'"
        class="min-w-0"
        :aria-label="t('settings.sections.storage')"
      >
        <S3StorageSettingsPanel />
      </section>
      <section
        id="settings-preferences"
        v-show="activeSection === 'preferences'"
        class="min-w-0 space-y-4"
        :aria-label="t('settings.sections.preferences')"
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
      </section>
    </div>
  </div>
</template>
