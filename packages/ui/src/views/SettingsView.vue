<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  AlertTriangle,
  Database,
  Download,
  Globe2,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UnlockKeyhole
} from '@lucide/vue';

import {
  ALIBABA_GATEWAY,
  CREDENTIAL_VAULT_DEFAULT_IDLE_TIMEOUT_MINUTES,
  CREDENTIAL_VAULT_IDLE_TIMEOUT_OPTIONS,
  CREDENTIAL_VAULT_ITERATIONS,
  CREDENTIAL_VAULT_MIN_PASSPHRASE_BYTES,
  type CredentialVaultStatus,
  type DiagnosticsSnapshot,
  type GatewaySettings,
  type LocalDataInventory,
  type SignMethod
} from '@one-vegetable/core';

import PageHeader from '../components/PageHeader.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';

const { gateway, settings, permissions, localData, vault, mode } = useServices();
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
const diagnosticsError = ref('');
const grantedHosts = ref<string[]>([]);
const permissionsBusy = ref(false);
const permissionsError = ref('');
const dataInventory = ref<LocalDataInventory | null>(null);
const dataBusy = ref(false);
const dataError = ref('');
const clearConfirmation = ref('');
const vaultStatus = ref<CredentialVaultStatus | null>(null);
const vaultPassphrase = ref('');
const vaultPassphraseConfirmation = ref('');
const newVaultPassphrase = ref('');
const newVaultPassphraseConfirmation = ref('');
const vaultBusy = ref(false);
const vaultError = ref('');
const idleTimeoutMinutes = ref(CREDENTIAL_VAULT_DEFAULT_IDLE_TIMEOUT_MINUTES);
const settingsEditable = computed(
  () => mode === 'mock' || vaultStatus.value?.state === 'empty' || vaultStatus.value?.state === 'unlocked'
);
const lastDiagnosticError = computed(() =>
  diagnostics.value?.entries.findLast((entry) => entry.outcome === 'error')
);
const vaultActivitySummary = computed(() => {
  const status = vaultStatus.value;
  if (!status?.lastActivityAt || status.idleRemainingSeconds === null) return '';
  const lastActivity = new Date(status.lastActivityAt).toLocaleString('zh-CN', { hour12: false });
  const remainingMinutes = Math.max(1, Math.ceil(status.idleRemainingSeconds / 60));
  return `最近活动：${lastActivity}；状态快照剩余约 ${remainingMinutes} 分钟。`;
});

onMounted(async () => {
  const [, , , storedSettings] = await Promise.all([
    refreshDiagnostics(),
    refreshPermissions(),
    refreshLocalData(),
    initializeSettings()
  ]);
  if (storedSettings) model.value = storedSettings;
});

async function initializeSettings(): Promise<GatewaySettings | undefined> {
  if (mode !== 'extension' || !vault) return settings.load();
  await refreshVaultStatus();
  if (vaultStatus.value?.state === 'locked' || vaultStatus.value?.state === 'invalid') return undefined;
  return settings.load();
}

async function save(): Promise<void> {
  saving.value = true;
  feedback.value = '';
  vaultError.value = '';
  try {
    if (mode === 'extension' && vault && vaultStatus.value?.state === 'empty') {
      assertMatchingPassphrases(vaultPassphrase.value, vaultPassphraseConfirmation.value);
      applyVaultStatus(await vault.create(vaultPassphrase.value, model.value));
      clearVaultPassphrases();
      feedback.value = '加密凭证保险库已创建并保持解锁。';
      await refreshLocalData();
    } else {
      await settings.save(model.value);
      feedback.value =
        mode === 'mock' ? 'Mock 设置已保存在本地浏览器。' : '设置已重新加密写入 chrome.storage.local。';
      model.value = await settings.load();
    }
  } catch (error: unknown) {
    vaultError.value = error instanceof Error ? error.message : '设置保存失败';
  } finally {
    saving.value = false;
  }
}

async function refreshVaultStatus(): Promise<void> {
  if (!vault) return;
  vaultError.value = '';
  try {
    applyVaultStatus(await vault.status());
  } catch (error: unknown) {
    vaultError.value = error instanceof Error ? error.message : '保险库状态读取失败';
  }
}

async function unlockVault(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = '';
  try {
    applyVaultStatus(await vault.unlock(vaultPassphrase.value));
    model.value = await settings.load();
    clearVaultPassphrases();
    feedback.value = '凭证保险库已解锁；service worker 重启后会自动重新锁定。';
  } catch (error: unknown) {
    vaultError.value = error instanceof Error ? error.message : '保险库解锁失败';
  } finally {
    vaultBusy.value = false;
  }
}

async function migrateVault(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = '';
  try {
    assertMatchingPassphrases(vaultPassphrase.value, vaultPassphraseConfirmation.value);
    applyVaultStatus(await vault.migrate(vaultPassphrase.value));
    model.value = await settings.load();
    clearVaultPassphrases();
    feedback.value = '旧版明文凭证已原位迁移到加密保险库。';
    await refreshLocalData();
  } catch (error: unknown) {
    vaultError.value = error instanceof Error ? error.message : '保险库迁移失败';
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
    feedback.value = '保险库已锁定，页面中的可编辑凭证状态已清空。';
  } catch (error: unknown) {
    vaultError.value = error instanceof Error ? error.message : '保险库锁定失败';
  } finally {
    vaultBusy.value = false;
  }
}

async function rotateVaultPassphrase(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = '';
  try {
    assertMatchingPassphrases(newVaultPassphrase.value, newVaultPassphraseConfirmation.value);
    applyVaultStatus(await vault.rotate(newVaultPassphrase.value));
    clearVaultPassphrases();
    feedback.value = '保险库已使用新 salt 和新口令重新加密。';
  } catch (error: unknown) {
    vaultError.value = error instanceof Error ? error.message : '保险库口令更换失败';
  } finally {
    vaultBusy.value = false;
  }
}

async function updateVaultPolicy(): Promise<void> {
  if (!vault) return;
  vaultBusy.value = true;
  vaultError.value = '';
  try {
    applyVaultStatus(await vault.updatePolicy(idleTimeoutMinutes.value));
    feedback.value = `保险库将在连续 ${idleTimeoutMinutes.value} 分钟未使用凭证后自动锁定。`;
  } catch (error: unknown) {
    vaultError.value = error instanceof Error ? error.message : '空闲锁定策略保存失败';
  } finally {
    vaultBusy.value = false;
  }
}

function applyVaultStatus(status: CredentialVaultStatus): void {
  vaultStatus.value = status;
  if (status.idleTimeoutMinutes !== null) idleTimeoutMinutes.value = status.idleTimeoutMinutes;
}

function assertMatchingPassphrases(passphrase: string, confirmation: string): void {
  if (new TextEncoder().encode(passphrase).byteLength < CREDENTIAL_VAULT_MIN_PASSPHRASE_BYTES) {
    throw new Error(`保险库口令至少需要 ${CREDENTIAL_VAULT_MIN_PASSPHRASE_BYTES} 个 UTF-8 字节`);
  }
  if (passphrase !== confirmation) throw new Error('两次输入的保险库口令不一致');
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
  permissionsError.value = '';
  try {
    grantedHosts.value = await permissions.list();
  } catch (error: unknown) {
    permissionsError.value = error instanceof Error ? error.message : '主机权限加载失败';
  } finally {
    permissionsBusy.value = false;
  }
}

async function revokePermission(origin: string): Promise<void> {
  if (!permissions) return;
  permissionsBusy.value = true;
  permissionsError.value = '';
  try {
    const removed = await permissions.revoke(origin);
    await refreshPermissions();
    feedback.value = removed ? `已撤销 ${origin}；再次使用时会重新请求授权。` : `${origin} 当前未授权。`;
  } catch (error: unknown) {
    permissionsError.value = error instanceof Error ? error.message : '主机权限撤销失败';
  } finally {
    permissionsBusy.value = false;
  }
}

async function refreshDiagnostics(): Promise<void> {
  diagnosticsBusy.value = true;
  diagnosticsError.value = '';
  try {
    diagnostics.value = await gateway.request('getDiagnostics', undefined);
  } catch (error: unknown) {
    diagnosticsError.value = error instanceof Error ? error.message : '诊断加载失败';
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
  diagnosticsError.value = '';
  try {
    await gateway.request('clearDiagnostics', undefined);
    diagnostics.value = await gateway.request('getDiagnostics', undefined);
    feedback.value = '诊断记录已清空。';
  } catch (error: unknown) {
    diagnosticsError.value = error instanceof Error ? error.message : '诊断清理失败';
  } finally {
    diagnosticsBusy.value = false;
  }
}

async function refreshLocalData(): Promise<void> {
  if (!localData) return;
  dataBusy.value = true;
  dataError.value = '';
  try {
    dataInventory.value = await localData.inspect();
  } catch (error: unknown) {
    dataError.value = error instanceof Error ? error.message : '本地数据清单加载失败';
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
  dataError.value = '';
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
    dataError.value = error instanceof Error ? error.message : '扩展本地数据清除失败';
  } finally {
    dataBusy.value = false;
  }
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
            <h2 class="font-semibold">凭证保险库</h2>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            PBKDF2-HMAC-SHA256 {{ CREDENTIAL_VAULT_ITERATIONS.toLocaleString() }} 次派生 AES-256-GCM
            密钥；口令不保存，后台重启后需重新解锁。
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
            vaultStatus.lockReason === 'idle' ? '保险库已因空闲超时自动锁定' : '输入口令解锁当前浏览器会话'
          }}
        </p>
        <p v-if="vaultStatus.lockReason === 'idle'" class="mt-1 text-xs text-muted-foreground">
          页面与后台中的解锁状态已清除，重新输入口令后才能继续真实查询。
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Input
            v-model="vaultPassphrase"
            class="max-w-sm"
            type="password"
            aria-label="保险库口令"
            autocomplete="current-password"
          />
          <Button :disabled="vaultBusy || !vaultPassphrase" @click="unlockVault">
            <UnlockKeyhole class="size-4" />解锁
          </Button>
        </div>
      </div>
      <div v-else-if="vaultStatus?.state === 'invalid'" class="mt-4 rounded-lg bg-red-50 p-4 text-red-900">
        <p class="text-sm font-medium">保险库记录无效</p>
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
            仅实际读取或更新凭证会刷新计时；查看状态不会延长会话。service worker 提前终止时仍会立即锁定。
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
                {{ minutes }} 分钟
              </option>
            </select>
            <Button variant="outline" :disabled="vaultBusy" @click="updateVaultPolicy">保存锁定策略</Button>
          </div>
        </div>
        <div class="rounded-lg border p-4">
          <p class="text-sm font-medium">更换保险库口令</p>
          <p class="mt-1 text-xs text-muted-foreground">
            将生成新 salt 和新密钥重新加密，不需要旧口令再次参与。
          </p>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              v-model="newVaultPassphrase"
              type="password"
              aria-label="新保险库口令"
              autocomplete="new-password"
              placeholder="至少 12 个 UTF-8 字节"
            />
            <Input
              v-model="newVaultPassphraseConfirmation"
              type="password"
              aria-label="确认新保险库口令"
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
          aria-label="新建保险库口令"
          autocomplete="new-password"
          placeholder="至少 12 个 UTF-8 字节"
        />
        <Input
          v-model="vaultPassphraseConfirmation"
          type="password"
          aria-label="确认保险库口令"
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
      <p v-if="vaultError" class="mt-3 text-sm text-destructive">{{ vaultError }}</p>
    </Card>

    <Card v-if="settingsEditable" class="p-5">
      <div class="mb-4 flex items-center gap-2">
        <KeyRound class="size-4 text-primary" />
        <h2 class="font-semibold">国际站开放平台凭证</h2>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium"
          >App Key<Input v-model="model.appKey" class="mt-2" autocomplete="off"
        /></label>
        <label class="text-sm font-medium"
          >App Secret<Input
            v-model="model.appSecret"
            class="mt-2"
            type="password"
            autocomplete="new-password"
            :placeholder="vaultStatus?.hasAppSecret ? '已加密保存，留空保持不变' : ''"
        /></label>
        <label class="text-sm font-medium sm:col-span-2"
          >Access Token<Input
            v-model="model.accessToken"
            class="mt-2"
            type="password"
            autocomplete="new-password"
            :placeholder="vaultStatus?.hasAccessToken ? '已加密保存，留空保持不变' : ''"
        /></label>
        <label class="text-sm font-medium sm:col-span-2"
          >HTTPS 网关<Input v-model="model.endpoint" class="mt-2"
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
          (mode === 'extension' &&
            vaultStatus?.state === 'empty' &&
            (!vaultPassphrase || !vaultPassphraseConfirmation))
        "
        @click="save"
        ><Save class="size-4" />{{ vaultStatus?.state === 'empty' ? '创建保险库并保存' : '保存设置' }}</Button
      >
    </Card>
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
    <Card v-if="mode === 'extension' && permissions" class="p-5">
      <div class="flex items-center gap-2">
        <Globe2 class="size-4 text-primary" />
        <h2 class="font-semibold">主机权限</h2>
      </div>
      <p class="mt-2 text-sm text-muted-foreground">
        正式网关为扩展必选权限；下面只列出曾由自定义网关或外部图片转存按需授予的主机。
      </p>
      <p v-if="permissionsError" class="mt-3 text-sm text-destructive">{{ permissionsError }}</p>
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
            @click="revokePermission(origin)"
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
            仅保留最近 100 条操作名、耗时、错误码和 traceId；不记录请求参数、凭证或响应正文。
          </p>
        </div>
        <span aria-label="诊断记录数量" class="rounded-full bg-muted px-3 py-1 text-xs">
          {{ diagnostics?.entries.length ?? 0 }} 条
        </span>
      </div>
      <div v-if="lastDiagnosticError" class="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
        最近错误：{{ lastDiagnosticError.errorCode }} · {{ lastDiagnosticError.operation }} ·
        {{ lastDiagnosticError.errorMessage }}
      </div>
      <p v-if="diagnosticsError" class="mt-3 text-sm text-destructive">{{ diagnosticsError }}</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" :disabled="diagnosticsBusy" @click="refreshDiagnostics">
          <RotateCcw class="size-4" />刷新
        </Button>
        <Button variant="outline" :disabled="diagnosticsBusy" @click="exportDiagnostics">
          <Download class="size-4" />导出诊断
        </Button>
        <Button variant="outline" :disabled="diagnosticsBusy" @click="clearDiagnostics">
          <Trash2 class="size-4" />清空诊断
        </Button>
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
      <p v-if="dataError" class="mt-3 text-sm text-destructive">{{ dataError }}</p>
      <div class="mt-4 overflow-x-auto rounded-lg border">
        <table class="w-full min-w-[620px] text-left text-sm">
          <thead class="bg-muted/70 text-xs text-muted-foreground">
            <tr>
              <th class="px-3 py-2 font-medium">类别</th>
              <th class="px-3 py-2 font-medium">存储位置</th>
              <th class="px-3 py-2 font-medium">数量</th>
              <th class="px-3 py-2 font-medium">大小</th>
              <th class="px-3 py-2 font-medium">保留时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="category in dataInventory?.categories ?? []" :key="category.id" class="border-t">
              <td class="px-3 py-3">
                {{ category.label }}
                <span v-if="category.sensitive" class="ml-1 text-xs text-amber-700">敏感</span>
              </td>
              <td class="px-3 py-3">
                <code class="text-xs">{{ category.storage }}</code>
              </td>
              <td class="px-3 py-3">{{ category.itemCount }}</td>
              <td class="px-3 py-3">{{ formatBytes(category.approximateBytes) }}</td>
              <td class="px-3 py-3 text-xs text-muted-foreground">{{ category.retention }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
</template>
