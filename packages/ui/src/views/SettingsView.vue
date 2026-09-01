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
  settingsConfirmation.value?.kind === 'revoke-permission' ? '确认撤销主机权限' : '确认清空诊断'
);
const settingsConfirmationDescription = computed(() => {
  const confirmation = settingsConfirmation.value;
  if (!confirmation) return '';
  return confirmation.kind === 'revoke-permission'
    ? `撤销 ${confirmation.origin} 后，再次访问该主机时 Chrome 会重新询问授权。`
    : `将清除当前保存的 ${diagnostics.value?.entries.length ?? 0} 条脱敏诊断记录。`;
});
const clearDiagnosticsDisabledReason = computed(() => {
  if (diagnosticsBusy.value) return '正在处理诊断记录';
  if ((diagnostics.value?.entries.length ?? 0) === 0) return '当前没有可清空的诊断记录';
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
  return `最近活动：${lastActivity}；状态快照剩余约 ${remainingMinutes} 分钟。`;
});

const localDataColumns: DataColumn<LocalDataCategory>[] = [
  {
    accessorKey: 'label',
    header: '类别',
    cell: ({ row }) =>
      h('span', [
        row.original.label,
        row.original.sensitive
          ? h('span', { class: 'ml-1 text-xs text-amber-700 dark:text-amber-400' }, '敏感')
          : null
      ])
  },
  {
    accessorKey: 'storage',
    header: '存储位置',
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.storage)
  },
  { accessorKey: 'itemCount', header: '数量' },
  {
    accessorKey: 'approximateBytes',
    header: '大小',
    cell: ({ row }) => formatBytes(row.original.approximateBytes)
  },
  {
    accessorKey: 'retention',
    header: '保留时间',
    cell: ({ row }) => h('span', { class: 'text-xs text-muted-foreground' }, row.original.retention)
  }
];

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
      feedback.value = '凭证与设置已加密保存，并将在当前 Chrome 会话内保持可用。';
      toast.success('凭证与设置已保存');
      await refreshLocalData();
    } else {
      await settings.save(model.value);
      feedback.value =
        mode === 'mock' ? '演示设置已保存在本地浏览器。' : '设置已重新加密写入 chrome.storage.local。';
      model.value = await settings.load();
      toast.success(mode === 'mock' ? '演示设置已保存' : '设置已保存');
    }
  } catch (error: unknown) {
    const visibleError = userVisibleCause(error, '设置保存失败');
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
    if (file.size > 256 * 1024) throw new Error('授权包 JSON 不能超过 256 KiB');
    const imported = readImportedCredentials(JSON.parse(await file.text()) as unknown);
    model.value = { ...model.value, ...imported };
    feedback.value =
      '已从授权包读取 App Key、App Secret 和 Access Token；尚未保存，请设置本机保护口令并确认保存。';
  } catch (error: unknown) {
    credentialImportError.value = userVisibleCause(error, '授权包导入失败');
  } finally {
    input.value = '';
  }
}

async function handleAcquiredCredentialsSaved(status: CredentialVaultStatus): Promise<void> {
  applyVaultStatus(status);
  model.value = await settings.load();
  feedback.value = 'Alibaba 开放平台凭据已获取并加密保存，当前 Chrome 会话内可以直接使用。';
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
    throw new Error('授权包缺少 App Key、App Secret 或 Access Token');
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
    vaultError.value = userVisibleCause(error, '凭证保护状态读取失败');
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
    feedback.value = '凭证已解锁；刷新页面或后台休眠后无需重复输入口令。';
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, '凭证解锁失败');
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
    feedback.value = '旧版明文凭证已原位加密，并在当前 Chrome 会话内保持可用。';
    await refreshLocalData();
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, '旧凭证加密失败');
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
    feedback.value = '凭证已锁定，当前 Chrome 会话中的解锁状态已清除。';
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, '凭证锁定失败');
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
    feedback.value = '凭证已使用新 salt 和新口令重新加密。';
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, '保护口令更换失败');
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
        ? '已关闭空闲自动锁定；当前 Chrome 会话内将保持可用。'
        : `开放平台凭证将在连续 ${idleTimeoutMinutes.value} 分钟未使用后自动锁定。`;
  } catch (error: unknown) {
    vaultError.value = userVisibleCause(error, '空闲锁定策略保存失败');
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
  if (passphrase !== confirmation) throw new Error('两次输入的本机保护口令不一致');
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
    permissionsError.value = userVisibleCause(error, '主机权限加载失败');
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
    feedback.value = removed ? `已撤销 ${origin}；再次使用时会重新请求授权。` : `${origin} 当前未授权。`;
  } catch (error: unknown) {
    permissionsError.value = userVisibleCause(error, '主机权限撤销失败');
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
    diagnosticsError.value = userVisibleCause(error, '诊断加载失败');
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
  feedback.value = `已导出 ${diagnostics.value.entries.length} 条脱敏诊断。`;
}

async function clearDiagnostics(): Promise<void> {
  diagnosticsBusy.value = true;
  diagnosticsError.value = null;
  try {
    await gateway.request('clearDiagnostics', undefined);
    diagnostics.value = await gateway.request('getDiagnostics', undefined);
    feedback.value = '诊断记录已清空。';
  } catch (error: unknown) {
    diagnosticsError.value = userVisibleCause(error, '诊断清理失败');
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
    dataError.value = userVisibleCause(error, '本地数据清单加载失败');
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
  feedback.value = '已导出不包含具体值的本地数据清单。';
}

async function clearAllLocalData(): Promise<void> {
  if (!localData || clearConfirmation.value !== '清除全部数据') return;
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
    feedback.value = '扩展本地数据和额外主机权限已清除；重新加载后会再次显示首次使用说明。';
  } catch (error: unknown) {
    dataError.value = userVisibleCause(error, '扩展本地数据清除失败');
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
  feedback.value = `接口语言偏好已保存为 ${preferredLanguage.value}。`;
}
</script>

<template>
  <PageHeader
    title="连接设置"
    description="凭证不会进入页面请求；扩展模式下仅由 MV3 service worker 读取并签名。"
  />
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
            <h2 class="font-semibold">开放平台凭证保护</h2>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            凭证加密保存在本机。解锁后，刷新页面或 MV3
            后台休眠不会要求重复输入口令；浏览器重启、扩展更新、主动锁定或所选空闲时限到期后才会重新锁定。
          </p>
        </div>
        <span class="rounded-full bg-muted px-3 py-1 text-xs">
          {{
            vaultStatus === null
              ? '读取中'
              : vaultStatus.state === 'unlocked'
                ? '已解锁'
                : vaultStatus.state === 'legacy'
                  ? '待迁移'
                  : vaultStatus.state === 'empty'
                    ? '未创建'
                    : vaultStatus.state === 'invalid'
                      ? '格式无效'
                      : '已锁定'
          }}
        </span>
      </div>

      <div v-if="vaultStatus?.state === 'legacy'" class="mt-4 rounded-lg bg-amber-50 p-4 text-amber-900">
        <p class="text-sm font-medium">发现旧版明文凭证</p>
        <p class="mt-1 text-xs leading-5">
          真实请求已停止读取该记录。设置新口令后会在 service worker 内直接加密迁移，页面不会收到旧 App Secret
          或 Access Token。
        </p>
      </div>
      <div v-else-if="vaultStatus?.state === 'locked'" class="mt-4 rounded-lg border p-4">
        <p class="text-sm font-medium">
          {{
            vaultStatus.lockReason === 'idle'
              ? '开放平台凭证已因空闲超时自动锁定'
              : vaultStatus.lockReason === 'session-ended'
                ? 'Chrome 会话已结束，需要重新解锁'
                : '开放平台凭证已手动锁定'
          }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{
            vaultStatus.lockReason === 'session-ended'
              ? '浏览器重启、扩展更新或重载会清除仅存于内存的会话解锁材料；本地加密凭据仍然安全保存。'
              : '页面与后台中的解锁状态已清除，重新输入口令后才能继续真实查询。'
          }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Input
            v-model="vaultPassphrase"
            class="max-w-sm"
            type="password"
            aria-label="保护口令"
            autocomplete="current-password"
          />
          <Button :disabled="vaultBusy || !vaultPassphrase" @click="unlockVault">
            <UnlockKeyhole class="size-4" />解锁
          </Button>
        </div>
      </div>
      <div v-else-if="vaultStatus?.state === 'invalid'" class="mt-4 rounded-lg bg-red-50 p-4 text-red-900">
        <p class="text-sm font-medium">本机凭证记录无效</p>
        <p class="mt-1 text-xs leading-5">
          为避免覆盖无法恢复的数据，当前不提供自动修复。请先备份浏览器配置，再使用下方彻底清除功能重新开始。
        </p>
      </div>
      <div v-else-if="vaultStatus?.state === 'unlocked'" class="mt-4 grid gap-4">
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" :disabled="vaultBusy" @click="lockVault">
            <LockKeyhole class="size-4" />立即锁定
          </Button>
        </div>
        <div class="rounded-lg border p-4">
          <p class="text-sm font-medium">空闲自动锁定</p>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            默认不因空闲自动锁定；只有选择时长后才会启用。MV3 后台休眠不会清除当前 Chrome 会话的解锁状态。
          </p>
          <p v-if="vaultActivitySummary" class="mt-2 text-xs text-muted-foreground">
            {{ vaultActivitySummary }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <select
              v-model.number="idleTimeoutMinutes"
              class="h-9 rounded-md border bg-background px-3 text-sm"
              aria-label="空闲自动锁定时间"
            >
              <option
                v-for="minutes in CREDENTIAL_VAULT_IDLE_TIMEOUT_OPTIONS"
                :key="minutes"
                :value="minutes"
              >
                {{ minutes === 0 ? '不自动锁定（默认）' : `${minutes} 分钟` }}
              </option>
            </select>
            <Button variant="outline" :disabled="vaultBusy" @click="updateVaultPolicy">保存锁定策略</Button>
          </div>
        </div>
        <div class="rounded-lg border p-4">
          <p class="text-sm font-medium">更换本机保护口令</p>
          <p class="mt-1 text-xs text-muted-foreground">
            将生成新 salt 和新密钥重新加密，不需要旧口令再次参与。
          </p>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              v-model="newVaultPassphrase"
              type="password"
              aria-label="新保护口令"
              autocomplete="new-password"
              :placeholder="`至少 ${CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS} 位`"
            />
            <Input
              v-model="newVaultPassphraseConfirmation"
              type="password"
              aria-label="确认新保护口令"
              autocomplete="new-password"
              placeholder="再次输入"
            />
          </div>
          <Button
            class="mt-3"
            variant="outline"
            :disabled="vaultBusy || !newVaultPassphrase || !newVaultPassphraseConfirmation"
            @click="rotateVaultPassphrase"
          >
            <RotateCcw class="size-4" />更换口令
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
          aria-label="设置保护口令"
          autocomplete="new-password"
          :placeholder="`至少 ${CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS} 位`"
        />
        <Input
          v-model="vaultPassphraseConfirmation"
          type="password"
          aria-label="确认保护口令"
          autocomplete="new-password"
          placeholder="再次输入"
        />
        <Button
          v-if="vaultStatus?.state === 'legacy'"
          class="sm:col-span-2"
          :disabled="vaultBusy || !vaultPassphrase || !vaultPassphraseConfirmation"
          @click="migrateVault"
        >
          <ShieldCheck class="size-4" />加密并迁移旧凭证
        </Button>
      </div>
      <ErrorNotice v-if="vaultError" class="mt-3" :error="vaultError" compact />
    </Card>

    <Card v-if="settingsEditable" class="p-5">
      <div class="mb-4 flex items-center gap-2">
        <KeyRound class="size-4 text-primary" />
        <h2 class="font-semibold">国际站开放平台凭证</h2>
      </div>
      <div class="mb-4 rounded-lg border bg-muted/40 p-4 text-sm leading-6">
        <p class="font-medium">三步完成真实接口连接</p>
        <p class="mt-1 text-muted-foreground">
          可以用插件向导复用当前 Chrome 登录态，读取已有应用并完成
          OAuth；遇到滑块、验证码或密钥安全确认时，直接在打开的 Alibaba
          标签页中处理。也可以手工填写或导入授权包。
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button
            v-if="alibabaCredentialAcquisition"
            size="sm"
            type="button"
            @click="credentialAcquisitionOpen = true"
          >
            <WandSparkles class="size-3.5" />获取开放平台凭证
          </Button>
          <a
            href="https://i.alibaba.com/explore/open-api"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            <ExternalLink class="size-3.5" />打开 Alibaba 应用中心
          </a>
          <label
            class="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            <FileUp class="size-3.5" />一键导入授权包 JSON
            <input
              class="sr-only"
              type="file"
              accept="application/json,.json"
              aria-label="导入授权包 JSON"
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
            :placeholder="vaultStatus?.hasAppSecret ? '已加密保存，留空保持不变' : ''"
        /></label>
        <label class="text-sm font-medium sm:col-span-2"
          >Access Token<Input
            v-model="model.accessToken"
            class="mt-2"
            type="password"
            aria-label="Access Token"
            autocomplete="new-password"
            :placeholder="vaultStatus?.hasAccessToken ? '已加密保存，留空保持不变' : ''"
        /></label>
        <label class="text-sm font-medium sm:col-span-2"
          >HTTPS 网关<Input v-model="model.endpoint" class="mt-2" aria-label="HTTPS 网关"
        /></label>
        <label class="text-sm font-medium"
          >签名算法<select
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
        {{ saving ? '保存中…' : '保存设置' }}
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
        <p class="font-medium">安全边界</p>
        <p class="mt-1 text-sm leading-6">
          加密可降低本地静态存储泄露风险，但已解锁或被恶意扩展控制的浏览器仍可能暴露 App
          Secret；高安全场景应迁移到用户控制的 BFF。
        </p>
      </div></Card
    >
    <ExtensionSocialBackendPanel v-if="mode === 'extension' && extensionSocialBackend" />
    <Card class="p-5">
      <div class="flex items-start gap-3">
        <Globe2 class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold">接口语言偏好</h2>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">
            用于商品 Schema、平台草稿、履约通道和地址 Schema 等支持 language 参数的请求；不改变当前界面语言。
          </p>
          <label class="mt-3 block max-w-xs text-sm font-medium">
            偏好语言
            <select
              v-model="preferredLanguage"
              class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
              aria-label="偏好语言"
              @change="confirmLanguagePreference"
            >
              <option value="zh_CN">简体中文（zh_CN）</option>
              <option value="en_US">English（en_US）</option>
            </select>
          </label>
        </div>
      </div>
    </Card>
    <Card v-if="mode === 'extension' && permissions" class="p-5">
      <div class="flex items-center gap-2">
        <Globe2 class="size-4 text-primary" />
        <h2 class="font-semibold">主机权限</h2>
      </div>
      <p class="mt-2 text-sm text-muted-foreground">
        正式网关为扩展必选权限；下面只列出曾由自定义网关或外部图片转存按需授予的主机。
      </p>
      <ErrorNotice v-if="permissionsError" class="mt-3" :error="permissionsError" compact />
      <p v-else-if="grantedHosts.length === 0" class="mt-3 text-sm text-muted-foreground">
        当前没有额外主机权限。
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
            :aria-label="`撤销 ${origin}`"
            :disabled="permissionsBusy"
            @click="settingsConfirmation = { kind: 'revoke-permission', origin }"
          >
            <Trash2 class="size-3.5" />撤销
          </Button>
        </li>
      </ul>
      <Button class="mt-3" variant="outline" :disabled="permissionsBusy" @click="refreshPermissions">
        <RotateCcw class="size-4" />刷新权限
      </Button>
    </Card>
    <Card class="p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <ShieldCheck class="size-4 text-primary" />
            <h2 class="font-semibold">脱敏诊断</h2>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            仅保留最近 100 条操作名、requestId、耗时、错误码和 traceId；不记录请求参数、凭证或响应正文。
          </p>
        </div>
        <span aria-label="诊断记录数量" class="rounded-full bg-muted px-3 py-1 text-xs">
          {{ diagnostics?.entries.length ?? 0 }} 条
        </span>
      </div>
      <div v-if="lastDiagnosticError" class="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
        最近错误：{{ lastDiagnosticError.errorCode }} · {{ lastDiagnosticError.operation }} ·
        {{ lastDiagnosticError.errorMessage }}
        <span class="mt-1 block break-all font-mono text-[11px]">
          requestId：{{ lastDiagnosticError.requestId }}
        </span>
      </div>
      <ErrorNotice v-if="diagnosticsError" class="mt-3" :error="diagnosticsError" compact />
      <div class="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" :disabled="diagnosticsBusy" @click="refreshDiagnostics">
          <RotateCcw class="size-4" />刷新
        </Button>
        <Button variant="outline" :disabled="diagnosticsBusy" @click="exportDiagnostics">
          <Download class="size-4" />导出诊断
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
            <Trash2 class="size-4" />清空诊断
          </Button>
        </ActionTooltip>
      </div>
    </Card>
    <Card v-if="mode === 'extension' && localData" class="p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <Database class="size-4 text-primary" />
            <h2 class="font-semibold">本地数据与隐私</h2>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            清单只包含类别和估算大小，不导出 App Secret、Access Token、草稿正文或诊断内容。
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
        empty-text="暂无本地数据"
      />
      <div class="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" :disabled="dataBusy" @click="refreshLocalData">
          <RotateCcw class="size-4" />刷新清单
        </Button>
        <Button variant="outline" :disabled="dataBusy" @click="exportLocalDataInventory">
          <Download class="size-4" />导出数据清单
        </Button>
      </div>
      <div class="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
        <div class="flex items-start gap-2 text-red-900">
          <AlertTriangle class="mt-0.5 size-4 shrink-0" />
          <div>
            <p class="text-sm font-medium">彻底清除扩展本地数据</p>
            <p class="mt-1 text-xs leading-5">
              此操作无法撤销。请输入“清除全部数据”，将删除凭证、设置、草稿、诊断、首次使用状态并撤销额外主机权限。
            </p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <Input
            v-model="clearConfirmation"
            class="max-w-xs bg-white"
            aria-label="清除确认短语"
            autocomplete="off"
            placeholder="清除全部数据"
          />
          <Button
            variant="outline"
            class="border-red-300 text-red-800 hover:bg-red-100"
            :disabled="dataBusy || clearConfirmation !== '清除全部数据'"
            @click="clearAllLocalData"
          >
            <Trash2 class="size-4" />彻底清除
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
    confirm-label="确认继续"
    @update:open="settingsConfirmation = $event ? settingsConfirmation : null"
    @confirm="confirmSettingsAction"
  >
    <p v-if="settingsConfirmation?.kind === 'clear-diagnostics'">
      诊断内容已经脱敏，但清空后无法恢复；该操作不会删除账号凭证或商品草稿。
    </p>
    <p v-else>该操作只撤销所选额外主机，不影响 Alibaba 正式网关的必选权限。</p>
  </ConfirmActionDialog>
</template>
