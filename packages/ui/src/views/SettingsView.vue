<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  BookOpen,
  Database,
  ExternalLink,
  FileUp,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  RotateCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
  WandSparkles
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import { parseAlibabaCredentialImport } from '@one-vegetable/core/credential-bundle';

import {
  ALIBABA_GATEWAY,
  alibabaAuthorizationMetadata,
  alibabaAccessTokenCapturedTime,
  CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS,
  validateVaultPassphrase,
  type CredentialVaultStatus,
  type GatewaySettings,
  type GatewayCredentialTestResult,
  type SignMethod
} from '@one-vegetable/core';

import AlibabaCredentialAcquisitionDialog from '../components/AlibabaCredentialAcquisitionDialog.vue';
import AlibabaAuthorizationProtocolDialog from '../components/AlibabaAuthorizationProtocolDialog.vue';
import AlibabaIndependentNotice from '../components/AlibabaIndependentNotice.vue';
import CredentialExpiryNotice from '../components/CredentialExpiryNotice.vue';
import CredentialConfigurationDialog from '../components/CredentialConfigurationDialog.vue';
import CredentialActionsSection from '../components/CredentialActionsSection.vue';
import AlibabaAuthorizationsPanel from '../components/AlibabaAuthorizationsPanel.vue';
import ConfirmActionDialog from '../components/ConfirmActionDialog.vue';
import GatewayProtocolNotice from '../components/settings/GatewayProtocolNotice.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import ExtensionSocialBackendPanel from '../components/ExtensionSocialBackendPanel.vue';
import PageHeader from '../components/PageHeader.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import ModalDialog from '../components/ui/ModalDialog.vue';
import { useUiI18n } from '../i18n';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { useUnsavedEditing, VAULT_UNLOCKED_EVENT } from '../lib/unsaved-editing';
import { parseAuthorizationSummary, useAlibabaAuthorizations } from '../lib/alibaba-authorizations';
import { notifyGatewayConfigurationChanged } from '../lib/gateway-configuration-events';
import { openAlibabaAuthorizationTool } from '../lib/alibaba-authorization-tool';
import { CREDENTIAL_VAULT_CHANGED_EVENT } from '../lib/credential-vault-events';
import { formatDateTime } from '../lib/date-time';

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
const credentialText = useGatewayCredentialsI18n();
const authorizations = useAlibabaAuthorizations();
const {
  summary: authorizationSummary,
  busy: authorizationBusy,
  error: authorizationError,
  canConfirm
} = authorizations;
const switchingAuthorization = ref(false);
const clearingAuthorization = ref<'top' | 'iop' | null>(null);
const configurationOpen = ref(false);
const manualConfigurationOpen = ref(false);
const testingAuthorization = ref(false);
const applyingAcquiredCredentials = ref(false);
const connectionTests = ref<Partial<Record<'top' | 'iop', GatewayCredentialTestResult>>>({});
const dualSettings = computed(
  () =>
    mode === 'extension' &&
    authorizationSummary.value !== null &&
    typeof settings.loadAuthorization === 'function'
);
const activeSection = ref('credentials');
const sections = computed(() => [
  { id: 'credentials', icon: KeyRound },
  ...((mode === 'bff' && control) || s3Storage ? [{ id: 'storage', icon: Database }] : []),
  { id: 'preferences', icon: Globe2 }
]);
const S3StorageSettingsPanel = defineAsyncComponent(() => import('../components/S3StorageSettingsPanel.vue'));
const GatewayAuthorizationsPanel =
  typeof __ONE_VEGETABLE_EXTENSION__ !== 'undefined' && __ONE_VEGETABLE_EXTENSION__
    ? null
    : defineAsyncComponent(() => import('../components/GatewayAuthorizationsPanel.vue'));
const { alibabaLanguage: preferredLanguage } = useAppPreferences();
const signMethods: SignMethod[] = ['hmac', 'md5', 'hmac-sha256'];
const model = ref<GatewaySettings>({
  appKey: '',
  appSecret: '',
  accessToken: '',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac'
});
const selectedProtocol = computed({
  get: () => model.value.protocol ?? 'top',
  set: (protocol: 'top' | 'iop') => {
    if (dualSettings.value) {
      void selectAuthorization(protocol);
      return;
    }
    model.value.protocol = protocol;
    model.value.endpoint = protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : ALIBABA_GATEWAY;
    model.value.signMethod = protocol === 'iop' ? 'hmac-sha256' : 'hmac';
  }
});
const saving = ref(false);
const credentialActionBusy = computed(
  () =>
    saving.value ||
    vaultBusy.value ||
    switchingAuthorization.value ||
    testingAuthorization.value ||
    applyingAcquiredCredentials.value
);
const configuredProfile = computed(() => authorizationSummary.value?.[selectedProtocol.value] ?? null);
const latestConnectionTest = computed(() => {
  const result = connectionTests.value[selectedProtocol.value];
  return result?.configurationId === configuredProfile.value?.configurationId ? result : null;
});
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
const protocolDialogPurpose = ref<'acquire' | 'renew' | null>(null);
const authorizationGuideRequested = ref(false);

function openAuthorizationGuide(): void {
  authorizationGuideRequested.value = true;
  protocolDialogPurpose.value = 'acquire';
}
const protocolImportFile = ref<File>();
const settingsLoaded = ref(false);
const credentialEditing = useUnsavedEditing(() => model.value, { enabled: () => settingsLoaded.value });
const passphraseEditing = useUnsavedEditing(
  () => ({
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
onMounted(async () => {
  if (mode === 'extension' && vault) {
    globalThis.addEventListener(CREDENTIAL_VAULT_CHANGED_EVENT, scheduleVaultReload);
    globalThis.document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  settingsInitialization = initializeView();
  await settingsInitialization;
});
let vaultReloadTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let vaultReloading = false;
let viewAlive = true;
onBeforeUnmount(() => {
  viewAlive = false;
  globalThis.clearTimeout(vaultReloadTimer);
  globalThis.removeEventListener(CREDENTIAL_VAULT_CHANGED_EVENT, scheduleVaultReload);
  globalThis.document.removeEventListener('visibilitychange', handleVisibilityChange);
});

function handleVisibilityChange(): void {
  if (globalThis.document.visibilityState === 'visible') scheduleVaultReload();
}

function scheduleVaultReload(): void {
  if (!viewAlive || mode !== 'extension' || !vault) return;
  globalThis.clearTimeout(vaultReloadTimer);
  vaultReloadTimer = globalThis.setTimeout(() => {
    void reloadExternalVault();
  }, 50);
}

async function reloadExternalVault(): Promise<void> {
  if (!viewAlive || !vault) return;
  if (!settingsLoaded.value || vaultReloading || vaultOperationPending()) {
    scheduleVaultReload();
    return;
  }
  vaultReloading = true;
  try {
    const next = await vault.status();
    if (!isViewAlive()) return;
    applyVaultStatus(next);
    if (next.state === 'locked' || next.state === 'invalid') {
      authorizations.reset();
      // Do not discard drafts: the locked view hides them until explicit unlock.
      return;
    }
    if (hasVaultEdits()) return;
    const protocol = selectedProtocol.value;
    const nextSettings = await loadSelectedAuthorization();
    if (!isViewAlive() || hasVaultEdits() || vaultOperationPending() || selectedProtocol.value !== protocol)
      return;
    model.value = nextSettings;
    clearVaultPassphrases();
    credentialEditing.markClean();
    passphraseEditing.markClean();
    await authorizations.reload();
  } catch {
    if (isViewAlive()) vaultError.value = new Error(t('settings.vault.statusError'));
  } finally {
    vaultReloading = false;
  }
}

// Read mutable reactive state afresh after async operations rather than relying on TS narrowing.
function isViewAlive(): boolean {
  return viewAlive;
}
function hasVaultEdits(): boolean {
  return Boolean(
    credentialEditing.dirty.value ||
    passphraseEditing.dirty.value ||
    vaultPassphrase.value ||
    vaultPassphraseConfirmation.value
  );
}
function vaultOperationPending(): boolean {
  return credentialActionBusy.value;
}

function handleProtectionPrepared(status: CredentialVaultStatus): void {
  applyVaultStatus(status);
  scheduleVaultReload();
}

async function initializeView(): Promise<void> {
  const storedSettings = await initializeSettings();
  if (storedSettings) model.value = storedSettings;
  credentialEditing.markClean();
  passphraseEditing.markClean();
  settingsLoaded.value = true;
  if (mode === 'extension' && settingsEditable.value) await authorizations.reload();
}

async function initializeSettings(): Promise<GatewaySettings | undefined> {
  if (mode !== 'extension' || !vault) return settings.load();
  await refreshVaultStatus();
  if (vaultStatus.value?.state === 'locked' || vaultStatus.value?.state === 'invalid') return undefined;
  return settings.load();
}

async function save(): Promise<void> {
  if (saving.value || vaultBusy.value) return;
  saving.value = true;
  feedback.value = '';
  vaultError.value = null;
  try {
    if (mode === 'extension' && vault && vaultStatus.value?.state === 'empty') {
      assertMatchingPassphrases(vaultPassphrase.value, vaultPassphraseConfirmation.value, true);
      const hadPassphrase = Boolean(vaultPassphrase.value);
      const created = await vault.create(vaultPassphrase.value, model.value);
      applyVaultStatus(created);
      clearVaultPassphrases();
      model.value = await loadSelectedAuthorization();
      credentialEditing.markClean();
      const configured = created.hasAppKey && created.hasAppSecret && created.hasAccessToken;
      const protectionSaved = hadPassphrase
        ? t('settings.vault.passphraseSaved')
        : credentialText('protectionSaved');
      feedback.value = configured ? t('settings.vault.saveEncrypted') : protectionSaved;
      toast.success(configured ? t('settings.vault.savedToast') : protectionSaved);
    } else {
      await settings.save(model.value);
      model.value = await loadSelectedAuthorization();
      credentialEditing.markClean();
      feedback.value =
        mode === 'mock'
          ? t('settings.credentials.mockSavedFeedback')
          : t('settings.credentials.encryptedSavedFeedback');
      toast.success(
        mode === 'mock' ? t('settings.credentials.mockSavedToast') : t('settings.credentials.savedToast')
      );
    }
    manualConfigurationOpen.value = false;
    if (mode === 'extension') {
      authorizations.invalidateBinding();
      await authorizations.reload();
      notifyGatewayConfigurationChanged();
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
    const parsed = JSON.parse(await file.text()) as unknown;
    if (alibabaCredentialAcquisition?.importBundles && (Array.isArray(parsed) || configurationOpen.value)) {
      const bundles = parseAlibabaCredentialImport(parsed);
      if (
        configurationOpen.value &&
        bundles.some((bundle) => (bundle.protocol ?? 'top') !== selectedProtocol.value)
      )
        throw new Error(credentialText('profileMismatch'));
      protocolImportFile.value = file;
      protocolDialogPurpose.value = 'acquire';
      return;
    }
    const imported = readImportedCredentials(parsed);
    if (configurationOpen.value && imported.protocol !== selectedProtocol.value)
      throw new Error(credentialText('profileMismatch'));
    if (dualSettings.value && settings.loadAuthorization) {
      const target = await settings.loadAuthorization(imported.protocol ?? 'top');
      model.value = { ...target, ...readImportedCredentials(parsed, target) };
    } else model.value = { ...model.value, ...imported };
    if (configurationOpen.value) manualConfigurationOpen.value = true;
    feedback.value = credentialText('protectionBundleLoaded');
  } catch (error: unknown) {
    credentialImportError.value = userVisibleCause(error, t('settings.credentials.bundleImportError'));
  } finally {
    input.value = '';
  }
}

async function handleAcquiredCredentialsSaved(status: CredentialVaultStatus): Promise<void> {
  applyingAcquiredCredentials.value = true;
  try {
    const protocol = selectedProtocol.value;
    applyVaultStatus(status);
    model.value =
      configurationOpen.value && settings.loadAuthorization
        ? await settings.loadAuthorization(protocol)
        : await settings.load();
    if (mode === 'extension') {
      authorizations.invalidateBinding();
      await authorizations.reload();
      notifyGatewayConfigurationChanged();
    }
    credentialEditing.markClean();
    feedback.value = t('settings.credentials.acquired');
  } catch (cause) {
    const error = userVisibleCause(cause, credentialText('error'));
    vaultError.value = error;
    toast.error(error.message);
  } finally {
    applyingAcquiredCredentials.value = false;
  }
}

function readImportedCredentials(
  value: unknown,
  current: GatewaySettings = model.value
): Pick<
  GatewaySettings,
  | 'appKey'
  | 'appSecret'
  | 'accessToken'
  | 'accessTokenExpiresTimeUtc'
  | 'accessTokenCapturedTimeUtc'
  | 'refreshToken'
  | 'refreshTokenExpiresTimeUtc'
  | 'systemApiPermission'
  | 'permissionCapturedTimeUtc'
  | 'protocol'
  | 'endpoint'
  | 'signMethod'
> {
  const root = objectValue(value);
  if (root.protocol !== undefined && root.protocol !== 'top' && root.protocol !== 'iop')
    throw new Error(credentialText('invalid'));
  const protocol = root.protocol ?? 'top';
  const application = objectValue(root.application);
  const oauth = objectValue(root.oauth);
  const appKey = importedString(root.appKey) ?? importedString(application.appKey);
  const appSecret = importedString(root.appSecret) ?? importedString(application.appSecret);
  const accessToken = importedString(root.accessToken) ?? importedString(oauth.accessToken);
  if (!appKey || !appSecret || !accessToken) {
    throw new Error(t('settings.credentials.bundleMissing'));
  }
  const expires =
    typeof oauth.expiresAtUtc === 'string' ? Date.parse(oauth.expiresAtUtc) : root.accessTokenExpiresTimeUtc;
  const refreshExpires =
    typeof oauth.refreshExpiresAtUtc === 'string'
      ? Date.parse(oauth.refreshExpiresAtUtc)
      : root.refreshTokenExpiresTimeUtc;
  return {
    protocol,
    endpoint: protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : ALIBABA_GATEWAY,
    signMethod: protocol === 'iop' ? 'hmac-sha256' : current.protocol === 'iop' ? 'hmac' : current.signMethod,
    appKey,
    appSecret,
    accessToken,
    ...(dualSettings.value
      ? {
          refreshToken: importedString(root.refreshToken) ?? importedString(oauth.refreshToken),
          refreshTokenExpiresTimeUtc:
            typeof refreshExpires === 'number' &&
            Number.isSafeInteger(refreshExpires) &&
            refreshExpires >= 0 &&
            refreshExpires <= 8_640_000_000_000_000
              ? refreshExpires
              : null
        }
      : {}),
    ...alibabaAuthorizationMetadata(value),
    accessTokenCapturedTimeUtc: alibabaAccessTokenCapturedTime(value),
    accessTokenExpiresTimeUtc:
      typeof expires === 'number' &&
      Number.isSafeInteger(expires) &&
      expires >= 0 &&
      expires <= 8_640_000_000_000_000
        ? expires
        : null
  };
}

function clearAuthorizationMetadata(): void {
  model.value.accessTokenExpiresTimeUtc = null;
  // Do not add a new nullable field to legacy settings solely because an input changed.
  // Restoring the original credential must not leave a phantom unsaved edit behind.
  if (model.value.accessTokenCapturedTimeUtc !== undefined) model.value.accessTokenCapturedTimeUtc = null;
  model.value.systemApiPermission = 'unknown';
  model.value.permissionCapturedTimeUtc = null;
  if (dualSettings.value) {
    // Replacing access credentials must not reuse a refresh token from the old grant.
    model.value.refreshToken = null;
    model.value.refreshTokenExpiresTimeUtc = null;
  }
}

function setRefreshToken(value: string | number): void {
  model.value.refreshToken = String(value);
  model.value.refreshTokenExpiresTimeUtc = null;
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
    applyVaultStatus(await vault.unlock(vaultStatus.value?.deviceProtected ? '' : vaultPassphrase.value));
    model.value = await settings.load();
    await authorizations.reload();
    clearVaultPassphrases();
    credentialEditing.markClean();
    passphraseEditing.markClean();
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
    await authorizations.reload();
    clearVaultPassphrases();
    credentialEditing.markClean();
    passphraseEditing.markClean();
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
    authorizations.reset();
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

async function loadSelectedAuthorization(): Promise<GatewaySettings> {
  return dualSettings.value && settings.loadAuthorization
    ? settings.loadAuthorization(selectedProtocol.value)
    : settings.load();
}

async function selectAuthorization(protocol: 'top' | 'iop', openConfiguration = false): Promise<void> {
  if (!settings.loadAuthorization || credentialActionBusy.value) return;
  if (selectedProtocol.value === protocol) {
    if (openConfiguration) configurationOpen.value = true;
    else toast.info(credentialText('profileAlreadySelected', { protocol: protocol.toUpperCase() }));
    return;
  }
  if (!(await credentialEditing.confirmLeave())) return;
  switchingAuthorization.value = true;
  credentialImportError.value = null;
  try {
    model.value = await settings.loadAuthorization(protocol);
    credentialEditing.markClean();
    feedback.value = '';
    if (openConfiguration) configurationOpen.value = true;
    else toast.info(credentialText('profileSelected', { protocol: protocol.toUpperCase() }));
  } catch (cause) {
    credentialImportError.value = userVisibleCause(cause, credentialText('error'));
  } finally {
    switchingAuthorization.value = false;
  }
}

function configureAuthorization(protocol: 'top' | 'iop'): void {
  void selectAuthorization(protocol, true);
}

async function closeCredentialConfiguration(open: boolean): Promise<void> {
  if (
    open ||
    credentialActionBusy.value ||
    manualConfigurationOpen.value ||
    protocolDialogPurpose.value ||
    clearingAuthorization.value
  )
    return;
  if (!(await discardCredentialEdits())) return;
  configurationOpen.value = false;
}

async function closeManualConfiguration(open: boolean): Promise<void> {
  if (open || credentialActionBusy.value) return;
  if (!(await discardCredentialEdits())) return;
  manualConfigurationOpen.value = false;
}

async function discardCredentialEdits(): Promise<boolean> {
  if (!credentialEditing.dirty.value) return true;
  if (!(await credentialEditing.confirmLeave())) return false;
  try {
    model.value = await loadSelectedAuthorization();
    credentialEditing.markClean();
    return true;
  } catch (cause) {
    credentialImportError.value = userVisibleCause(cause, credentialText('error'));
    return false;
  }
}

async function reloadSelectedProfile(): Promise<void> {
  if (credentialActionBusy.value || !(await discardCredentialEdits())) return;
  switchingAuthorization.value = true;
  credentialImportError.value = null;
  try {
    model.value = await loadSelectedAuthorization();
    credentialEditing.markClean();
    await authorizations.reload();
  } catch (cause) {
    credentialImportError.value = userVisibleCause(cause, credentialText('error'));
  } finally {
    switchingAuthorization.value = false;
  }
}

async function testSelectedAuthorization(): Promise<void> {
  if (!settings.testAuthorization || credentialActionBusy.value || !configuredProfile.value?.configured)
    return;
  const protocol = selectedProtocol.value;
  const configurationId = configuredProfile.value.configurationId;
  testingAuthorization.value = true;
  credentialImportError.value = null;
  try {
    const result = await settings.testAuthorization(protocol);
    if (
      !isViewAlive() ||
      selectedProtocol.value !== protocol ||
      authorizationSummary.value?.[protocol]?.configurationId !== configurationId
    )
      return;
    connectionTests.value[protocol] = result;
    if (result.status === 'passed' || result.status === 'no-data')
      toast.success(credentialText(result.status));
    else toast.error(credentialText(result.status));
  } catch (cause) {
    const error = userVisibleCause(cause, credentialText('error'));
    credentialImportError.value = error;
    toast.error(error.message);
  } finally {
    testingAuthorization.value = false;
  }
}

async function chooseDefaultAuthorization(protocol: 'top' | 'iop'): Promise<void> {
  const summary = authorizationSummary.value;
  const configurationId = summary?.[protocol]?.configurationId;
  if (
    !settings.setDefaultAuthorization ||
    !settings.loadAuthorization ||
    !configurationId ||
    switchingAuthorization.value ||
    authorizationBusy.value ||
    saving.value ||
    vaultBusy.value
  )
    return;
  if (summary.defaultProtocol === protocol) {
    toast.info(credentialText('defaultAlreadySelected', { protocol: protocol.toUpperCase() }));
    return;
  }
  if (!(await credentialEditing.confirmLeave())) return;
  switchingAuthorization.value = true;
  credentialImportError.value = null;
  try {
    authorizationSummary.value = await parseAuthorizationSummary(
      await settings.setDefaultAuthorization(protocol, configurationId)
    );
    notifyGatewayConfigurationChanged();
    model.value = await settings.loadAuthorization(protocol);
    credentialEditing.markClean();
    feedback.value = '';
    toast.success(credentialText('defaultSaved', { protocol: protocol.toUpperCase() }));
  } catch (cause) {
    await authorizations.reload();
    const error = userVisibleCause(cause, credentialText('error'));
    credentialImportError.value = error;
    toast.error(error.message);
  } finally {
    switchingAuthorization.value = false;
  }
}

async function renewAuthorization(protocol: 'top' | 'iop'): Promise<void> {
  if (!settings.refreshAuthorization || vaultBusy.value || saving.value) return;
  if (!(await credentialEditing.confirmLeave())) return;
  vaultBusy.value = true;
  vaultError.value = null;
  try {
    authorizationSummary.value = await settings.refreshAuthorization(protocol);
    model.value = await loadSelectedAuthorization();
    credentialEditing.markClean();
    notifyGatewayConfigurationChanged();
    toast.success(credentialText('refreshed'));
  } catch (cause) {
    await authorizations.reload();
    vaultError.value = userVisibleCause(cause, credentialText('refreshFailed'));
  } finally {
    vaultBusy.value = false;
  }
}

function selectAuthorizationProtocol(protocol: 'top' | 'iop'): void {
  const purpose = protocolDialogPurpose.value;
  protocolDialogPurpose.value = null;
  if (mode !== 'extension' || !purpose) return;
  if (purpose === 'renew') {
    void renewAuthorization(protocol);
    return;
  }
  if (!alibabaCredentialAcquisition) return;
  try {
    const pending = openAlibabaAuthorizationTool(alibabaCredentialAcquisition, protocol);
    if (pending) {
      void pending.catch(() => toast.error(credentialText('authorizationToolFailed')));
    } else if (protocol === 'top') {
      credentialAcquisitionOpen.value = true;
    } else {
      toast.error(credentialText('protocolToolUnavailable'));
    }
  } catch {
    toast.error(credentialText('authorizationToolFailed'));
  }
}

async function requestClearAuthorization(protocol: 'top' | 'iop'): Promise<void> {
  if (vaultBusy.value || saving.value || !(await credentialEditing.confirmLeave())) return;
  clearingAuthorization.value = protocol;
}

async function clearAuthorization(): Promise<void> {
  const protocol = clearingAuthorization.value;
  if (!protocol || !settings.clearAuthorization || vaultBusy.value) return;
  vaultBusy.value = true;
  vaultError.value = null;
  try {
    await settings.clearAuthorization(protocol);
    authorizations.invalidateBinding();
    await authorizations.reload();
    model.value = await loadSelectedAuthorization();
    credentialEditing.markClean();
    notifyGatewayConfigurationChanged();
  } catch (cause) {
    vaultError.value = userVisibleCause(cause, credentialText('error'));
  } finally {
    clearingAuthorization.value = null;
    vaultBusy.value = false;
  }
}

async function confirmAuthorizations(): Promise<void> {
  await authorizations.confirm();
  if (!authorizationError.value) notifyGatewayConfigurationChanged();
}

async function rotateVaultPassphrase(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = null;
  try {
    assertMatchingPassphrases(newVaultPassphrase.value, newVaultPassphraseConfirmation.value);
    applyVaultStatus(await vault.rotate(newVaultPassphrase.value));
    clearVaultPassphrases();
    passphraseEditing.markClean();
    feedback.value = t('settings.vault.rotatedFeedback');
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, t('settings.vault.rotateError'));
  } finally {
    vaultBusy.value = false;
  }
}

function applyVaultStatus(status: CredentialVaultStatus): void {
  vaultStatus.value = status;
}

function assertMatchingPassphrases(passphrase: string, confirmation: string, optional = false): void {
  if (!optional || passphrase) validateVaultPassphrase(passphrase);
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
        class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
      >
        {{ feedback }}
      </p>
      <section
        id="settings-credentials"
        v-show="activeSection === 'credentials'"
        class="min-w-0 space-y-4"
        :aria-label="t('settings.sections.credentials')"
      >
        <div v-if="mode === 'extension' && alibabaCredentialAcquisition" class="flex flex-wrap gap-2">
          <Button
            type="button"
            data-testid="open-authorization-guide"
            :disabled="credentialActionBusy"
            @click="openAuthorizationGuide"
            ><BookOpen class="size-4" />{{ credentialText('authorizationWizard') }}</Button
          >
        </div>
        <GatewayAuthorizationsPanel
          v-if="mode === 'bff' && runtime?.backendMeta?.runtime === 'node'"
          dialog-configuration
        />
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
        <AlibabaAuthorizationsPanel
          v-if="settingsEditable && dualSettings && authorizationSummary"
          :summary="authorizationSummary"
          :selected-protocol="selectedProtocol"
          :busy="authorizationBusy || credentialActionBusy"
          :configure-busy="credentialActionBusy"
          :can-confirm="canConfirm"
          :can-set-default="Boolean(settings.setDefaultAuthorization)"
          compact
          configure-actions
          extension
          @select="configureAuthorization"
          @set-default="chooseDefaultAuthorization"
          @confirm="confirmAuthorizations"
          @renew="protocolDialogPurpose = 'renew'"
          @clear="requestClearAuthorization"
        />
        <ErrorNotice
          v-if="authorizationError"
          :error="authorizationError"
          :fallback="credentialText('error')"
        />
        <Card
          v-if="mode === 'extension' && vault"
          class="p-5"
          data-testid="alibaba-credential-protection-panel"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <LockKeyhole class="size-4 text-primary" />
                <h2 class="font-semibold">{{ t('settings.vault.title') }}</h2>
              </div>
              <p class="mt-2 text-sm text-muted-foreground">
                {{
                  vaultStatus?.deviceProtected
                    ? credentialText('protectionDeviceHelp')
                    : t('settings.vault.description')
                }}
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
          <p
            v-if="vaultStatus?.deviceProtected"
            class="mt-2 text-sm font-medium"
            data-testid="vault-device-protected"
          >
            {{ credentialText('protectionDeviceStatus') }}
          </p>

          <div v-if="vaultStatus?.state === 'legacy'" class="mt-4 rounded-lg bg-amber-50 p-4 text-amber-900">
            <p class="text-sm font-medium">{{ t('settings.vault.legacyTitle') }}</p>
            <p class="mt-1 text-xs leading-5">
              {{ t('settings.vault.legacyDescription') }}
            </p>
          </div>
          <div v-else-if="vaultStatus?.state === 'locked'" class="mt-4 rounded-lg border p-4">
            <p class="text-sm font-medium">
              {{
                vaultStatus.lockReason === 'manual'
                  ? t('settings.vault.lockReason.manual')
                  : t('settings.vault.lockReason.existing')
              }}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{
                vaultStatus.deviceProtected
                  ? credentialText('protectionDeviceHelp')
                  : vaultStatus.lockReason !== 'manual'
                    ? t('settings.vault.lockDescription.existing')
                    : t('settings.vault.lockDescription.other')
              }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <Input
                v-if="!vaultStatus.deviceProtected"
                v-model="vaultPassphrase"
                class="max-w-sm"
                type="password"
                :aria-label="t('settings.vault.passphrase')"
                autocomplete="current-password"
              />
              <Button
                :disabled="vaultBusy || (!vaultStatus.deviceProtected && !vaultPassphrase)"
                @click="unlockVault"
              >
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
            class="mt-4 grid items-start gap-2 lg:grid-cols-[1fr_1fr_auto]"
            data-testid="vault-passphrase-setup"
          >
            <p
              v-if="vaultStatus?.state === 'empty'"
              class="text-sm lg:col-span-3"
              data-testid="vault-optional-protection"
            >
              {{ credentialText('protectionOptional') }} — {{ credentialText('protectionDeviceHelp') }}
            </p>
            <Input
              v-model="vaultPassphrase"
              type="password"
              :aria-label="t('settings.vault.setPassphrase')"
              autocomplete="new-password"
              :placeholder="
                vaultStatus?.state === 'empty'
                  ? credentialText('protectionPlaceholder')
                  : t('settings.vault.minimumCharacters', {
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
              v-if="vaultStatus?.state === 'empty'"
              type="button"
              data-testid="save-vault-near-passphrase"
              :disabled="saving || vaultBusy || !settingsLoaded"
              @click="save"
            >
              <LoaderCircle v-if="saving" class="size-4 animate-spin" />
              <Save v-else class="size-4" />{{
                saving ? t('settings.credentials.saving') : t('settings.vault.saveHere')
              }}
            </Button>
            <Button
              v-if="vaultStatus?.state === 'legacy'"
              :disabled="vaultBusy || !vaultPassphrase || !vaultPassphraseConfirmation"
              @click="migrateVault"
            >
              <ShieldCheck class="size-4" />{{ t('settings.vault.migrate') }}
            </Button>
          </div>
          <ErrorNotice v-if="vaultError" class="mt-3" :error="vaultError" compact />
        </Card>

        <CredentialConfigurationDialog
          v-if="settingsEditable && (!dualSettings || configurationOpen)"
          :open="configurationOpen"
          :protocol="selectedProtocol"
          :busy="credentialActionBusy"
          :inline="!dualSettings"
          @update:open="closeCredentialConfiguration"
        >
          <div v-if="!dualSettings" class="mb-4 flex items-center gap-2">
            <KeyRound class="size-4 text-primary" />
            <h2 class="font-semibold">{{ t('settings.credentials.title') }}</h2>
          </div>
          <AlibabaIndependentNotice v-if="!dualSettings" class="mb-4" />
          <component
            :is="dualSettings ? CredentialActionsSection : 'div'"
            kind="import"
            class="mb-4 text-sm leading-6"
            :class="dualSettings ? undefined : 'rounded-lg border bg-muted/40 p-4'"
          >
            <p v-if="!dualSettings" class="font-medium">{{ t('settings.credentials.guideTitle') }}</p>
            <p class="mt-1 text-muted-foreground" data-testid="alibaba-credential-acquisition-guide">
              {{
                mode === 'extension'
                  ? credentialText(selectedProtocol === 'iop' ? 'extensionGuideIop' : 'extensionGuideTop')
                  : t('settings.credentials.guideDescription')
              }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <Button
                v-if="mode === 'extension' && alibabaCredentialAcquisition"
                size="sm"
                variant="outline"
                type="button"
                :data-testid="dualSettings ? 'configure-acquire-credentials' : 'get-alibaba-credentials'"
                :disabled="credentialActionBusy"
                @click="protocolDialogPurpose = 'acquire'"
              >
                <WandSparkles class="size-3.5" />{{ credentialText('acquireCredentials') }}
              </Button>
              <Button
                v-if="dualSettings"
                size="sm"
                variant="outline"
                :disabled="credentialActionBusy"
                @click="manualConfigurationOpen = true"
                ><KeyRound class="size-3.5" />{{ credentialText('manual') }}</Button
              >
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
                  :disabled="credentialActionBusy"
                  @change="importCredentialBundle"
                />
              </label>
            </div>
            <ErrorNotice v-if="credentialImportError" class="mt-3" :error="credentialImportError" compact />
          </component>
          <CredentialExpiryNotice
            v-if="
              mode === 'extension' &&
              (dualSettings
                ? configuredProfile?.configured
                : vaultStatus?.hasAccessToken || model.accessToken)
            "
            :expires="model.accessTokenExpiresTimeUtc"
            :captured-time="model.accessTokenCapturedTimeUtc"
            :refresh-expires="model.refreshTokenExpiresTimeUtc"
            extension
          />
          <template v-if="dualSettings">
            <ErrorNotice v-if="vaultError" :error="vaultError" :fallback="credentialText('error')" compact />
            <CredentialActionsSection kind="connection" class="mt-4">
              <p class="text-xs text-muted-foreground">{{ credentialText('testNotice') }}</p>
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  :disabled="
                    credentialActionBusy || !configuredProfile?.configured || !settings.testAuthorization
                  "
                  @click="testSelectedAuthorization"
                >
                  <LoaderCircle v-if="testingAuthorization" class="size-4 animate-spin" />
                  <PlugZap v-else class="size-4" />{{ credentialText('test') }}
                </Button>
                <Button
                  variant="outline"
                  :disabled="
                    credentialActionBusy || !configuredProfile?.canRefresh || !settings.refreshAuthorization
                  "
                  @click="renewAuthorization(selectedProtocol)"
                >
                  <RotateCw class="size-4" />{{ credentialText('refresh') }}
                </Button>
                <Button variant="outline" :disabled="credentialActionBusy" @click="reloadSelectedProfile">
                  <RefreshCw class="size-4" />{{ credentialText('reload') }}
                </Button>
              </div>
              <p
                v-if="configuredProfile?.configured && !configuredProfile.canRefresh"
                class="text-xs text-muted-foreground"
              >
                {{ credentialText('noRefresh') }}
              </p>
              <div class="rounded-md bg-muted p-3 text-sm" aria-live="polite">
                <p>
                  {{ credentialText('lastTest') }}：{{
                    latestConnectionTest
                      ? credentialText(latestConnectionTest.status)
                      : credentialText('notTested')
                  }}
                </p>
                <p v-if="latestConnectionTest" class="mt-1 break-all text-xs">
                  {{ formatDateTime(latestConnectionTest.checkedAtUtc) }} ·
                  {{ latestConnectionTest.durationMilliseconds }} ms · {{ latestConnectionTest.requestId }}
                  <span v-if="latestConnectionTest.errorCode">· {{ latestConnectionTest.errorCode }}</span>
                </p>
              </div>
            </CredentialActionsSection>
            <div class="mt-4 flex justify-end border-t pt-4">
              <Button
                variant="outline"
                :disabled="
                  credentialActionBusy || !configuredProfile?.configured || !settings.clearAuthorization
                "
                @click="requestClearAuthorization(selectedProtocol)"
              >
                <Trash2 class="size-4" />{{ credentialText('clear') }}
              </Button>
            </div>
          </template>
          <component
            :is="dualSettings ? ModalDialog : 'div'"
            v-bind="
              dualSettings
                ? {
                    open: manualConfigurationOpen,
                    title: credentialText('manual'),
                    description: credentialText('profileIsolation'),
                    dismissible: !credentialActionBusy
                  }
                : {}
            "
            @update:open="closeManualConfiguration"
          >
            <form v-if="!dualSettings || manualConfigurationOpen" data-feedback-redact @submit.prevent="save">
              <ErrorNotice
                v-if="vaultError"
                :error="vaultError"
                :fallback="credentialText('error')"
                compact
              />
              <label class="mt-4 block text-sm font-medium">
                {{ credentialText('protocol') }}
                <select
                  v-model="selectedProtocol"
                  :disabled="dualSettings"
                  data-testid="authorization-profile-editor"
                  :aria-label="credentialText('protocol')"
                  class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="top">{{ credentialText('protocolTop') }}</option>
                  <option value="iop">{{ credentialText('protocolIop') }}</option>
                </select>
              </label>
              <GatewayProtocolNotice class="mt-2" :protocol="selectedProtocol" />
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="text-sm font-medium"
                  >App Key<Input
                    v-model="model.appKey"
                    @update:model-value="clearAuthorizationMetadata"
                    class="mt-2"
                    autocomplete="off"
                    aria-label="App Key"
                    data-feedback-redact
                /></label>
                <label class="text-sm font-medium"
                  >App Secret<Input
                    v-model="model.appSecret"
                    @update:model-value="clearAuthorizationMetadata"
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
                    @update:model-value="clearAuthorizationMetadata"
                    class="mt-2"
                    type="password"
                    aria-label="Access Token"
                    autocomplete="new-password"
                    :placeholder="
                      vaultStatus?.hasAccessToken ? t('settings.credentials.encryptedPlaceholder') : ''
                    "
                /></label>
                <label v-if="dualSettings" class="text-sm font-medium sm:col-span-2">
                  Refresh Token ({{ credentialText('optional') }})
                  <Input
                    :model-value="model.refreshToken ?? ''"
                    type="password"
                    class="mt-2"
                    autocomplete="new-password"
                    aria-label="Refresh Token"
                    data-feedback-redact
                    @update:model-value="setRefreshToken"
                  />
                </label>
                <label class="text-sm font-medium sm:col-span-2"
                  >{{ t('settings.credentials.gateway')
                  }}<Input
                    v-model="model.endpoint"
                    class="mt-2"
                    :aria-label="t('settings.credentials.gateway')"
                    :readonly="selectedProtocol === 'iop'"
                /></label>
                <label class="text-sm font-medium"
                  >{{ t('settings.credentials.signMethod')
                  }}<select
                    v-model="model.signMethod"
                    :disabled="selectedProtocol === 'iop'"
                    class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option v-for="item in signMethods" :key="item" :value="item">{{ item }}</option>
                  </select></label
                >
              </div>
              <div class="mt-4 flex justify-end gap-2">
                <Button
                  v-if="dualSettings"
                  type="button"
                  variant="outline"
                  :disabled="credentialActionBusy"
                  @click="closeManualConfiguration(false)"
                >
                  {{ credentialText('cancel') }}
                </Button>
                <Button type="submit" :disabled="credentialActionBusy || authorizationBusy">
                  <LoaderCircle v-if="saving" class="size-4 animate-spin" />
                  <Save v-else class="size-4" />
                  {{ saving ? t('settings.credentials.saving') : t('settings.credentials.save') }}
                </Button>
              </div>
            </form>
          </component>
          <AlibabaIndependentNotice v-if="dualSettings" class="mt-4" />
        </CredentialConfigurationDialog>
        <ConfirmActionDialog
          :open="clearingAuthorization !== null"
          :title="credentialText('confirmLocalClear')"
          :description="
            credentialText('profileClearBody', { protocol: clearingAuthorization?.toUpperCase() ?? '' })
          "
          :pending="vaultBusy"
          destructive
          @update:open="
            (open) => {
              if (!open && !vaultBusy) clearingAuthorization = null;
            }
          "
          @confirm="clearAuthorization"
        />
        <AlibabaCredentialAcquisitionDialog
          v-if="mode === 'extension' && alibabaCredentialAcquisition"
          v-model:open="credentialAcquisitionOpen"
          @saved="handleAcquiredCredentialsSaved"
        />
        <AlibabaAuthorizationProtocolDialog
          v-if="mode === 'extension'"
          :open="protocolDialogPurpose !== null"
          :purpose="protocolDialogPurpose ?? 'acquire'"
          :show-guide="authorizationGuideRequested"
          :vault="vault"
          :acquisition="alibabaCredentialAcquisition"
          :initial-file="protocolImportFile"
          :protocol="dualSettings && configurationOpen ? selectedProtocol : undefined"
          :before-import="hasVaultEdits() ? credentialEditing.confirmLeave : undefined"
          @prepared="handleProtectionPrepared"
          @imported="handleAcquiredCredentialsSaved"
          @update:open="
            (value) => {
              if (!value) {
                protocolDialogPurpose = null;
                authorizationGuideRequested = false;
                protocolImportFile = undefined;
              }
            }
          "
          @select="selectAuthorizationProtocol"
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
