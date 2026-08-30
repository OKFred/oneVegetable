<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { startRegistration } from '@simplewebauthn/browser';
import { Copy, KeyRound, PauseCircle, PlayCircle, RefreshCw, Shield, Sparkles, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';

import { parseAlibabaOpenApiCredentialBundle } from '@one-vegetable/core';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import type {
  AlibabaOpenApiCredentialBundle,
  ControlGatewayCredentialSummary,
  ControlPasskeyCredential,
  ControlRealMutationStatus
} from '@one-vegetable/core';

import { useServices } from '../lib/services';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import ModalDialog from './ui/ModalDialog.vue';
import AlibabaCloudCredentialAcquisitionDialog from './AlibabaCloudCredentialAcquisitionDialog.vue';

type Confirmation =
  | { kind: 'credential-import' }
  | { kind: 'credential-clear' }
  | { kind: 'pause'; paused: boolean }
  | { kind: 'passkey-remove'; credential: ControlPasskeyCredential }
  | { kind: 'recovery-codes' };

const { control } = useServices();
const credentials = ref<ControlGatewayCredentialSummary | null>(null);
const mutationControl = ref<ControlRealMutationStatus | null>(null);
const passkeys = ref<ControlPasskeyCredential[]>([]);
const pendingBundle = ref<AlibabaOpenApiCredentialBundle | null>(null);
const pendingFileName = ref('');
const confirmation = ref<Confirmation | null>(null);
const recoveryCodes = ref<string[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const acquisitionOpen = ref(false);

const confirmationTitle = computed(() => {
  if (confirmation.value?.kind === 'credential-import') return '确认导入 Alibaba 凭据';
  if (confirmation.value?.kind === 'credential-clear') return '确认清空 Alibaba 凭据';
  if (confirmation.value?.kind === 'passkey-remove') return '确认移除 Passkey';
  if (confirmation.value?.kind === 'recovery-codes') return '确认重置恢复码';
  return confirmation.value?.paused ? '暂停全部真实写入' : '恢复已验收真实写入';
});
const confirmationDescription = computed(() => {
  if (confirmation.value?.kind === 'credential-import') {
    return `将加密导入 ${pendingFileName.value}；页面和接口不会回显密钥。`;
  }
  if (confirmation.value?.kind === 'credential-clear')
    return '清空后真实 Alibaba 能力会立即停止，需重新导入。';
  if (confirmation.value?.kind === 'passkey-remove') return '该设备将不能再用于登录。唯一登录凭据不可移除。';
  if (confirmation.value?.kind === 'recovery-codes') return '现有恢复码会立即全部失效，新码只显示一次。';
  return confirmation.value?.paused
    ? '急停优先于所有 operation flag，任何已验收真实写操作都会在出网前被拒绝。'
    : '仅恢复固定白名单内、已完成真实验收的写操作。';
});

onMounted(refresh);

async function refresh(): Promise<void> {
  if (!control) return;
  loading.value = true;
  error.value = null;
  try {
    const [credentialStatus, pauseStatus, credentialList] = await Promise.all([
      control.gatewayCredentialStatus(),
      control.realMutationStatus?.() ?? Promise.resolve(null),
      control.listPasskeys?.() ?? Promise.resolve([])
    ]);
    credentials.value = credentialStatus;
    mutationControl.value = pauseStatus;
    passkeys.value = credentialList;
  } catch (cause: unknown) {
    error.value = userError(cause, '自托管设置加载失败');
  } finally {
    loading.value = false;
  }
}

async function selectCredentialFile(event: Event): Promise<void> {
  error.value = null;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('凭据文件不能超过 1 MiB。');
    const parsed: unknown = JSON.parse(await file.text());
    pendingBundle.value = parseAlibabaOpenApiCredentialBundle(parsed);
    pendingFileName.value = file.name;
    confirmation.value = { kind: 'credential-import' };
  } catch (cause: unknown) {
    pendingBundle.value = null;
    pendingFileName.value = '';
    error.value = userError(cause, 'credentials.json 无效');
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
    toast.success('新 Passkey 已登记。');
    await refresh();
  } catch (cause: unknown) {
    error.value = userError(cause, 'Passkey 登记失败');
  }
}

async function refreshCredential(): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    credentials.value = await control.refreshGatewayCredential();
    toast.success('Alibaba Token 已刷新。');
  } catch (cause: unknown) {
    error.value = userError(cause, 'Token 刷新失败');
  }
}

async function confirm(): Promise<void> {
  if (!control || !confirmation.value) return;
  loading.value = true;
  error.value = null;
  const action = confirmation.value;
  confirmation.value = null;
  try {
    if (action.kind === 'credential-import') {
      if (!pendingBundle.value) throw new Error('请重新选择凭据文件。');
      credentials.value = await control.importGatewayCredential(
        pendingBundle.value,
        credentials.value?.revision ?? null,
        `从 ${pendingFileName.value} 导入`
      );
      pendingBundle.value = null;
      pendingFileName.value = '';
      toast.success('Alibaba 凭据已加密导入。');
    } else if (action.kind === 'credential-clear') {
      if (credentials.value?.revision === null || credentials.value?.revision === undefined) return;
      await control.clearGatewayCredential(credentials.value.revision);
      toast.success('Alibaba 凭据已清空。');
    } else if (action.kind === 'pause') {
      if (!control.updateRealMutationPause) throw new Error('当前后端不支持真实写入急停。');
      mutationControl.value = await control.updateRealMutationPause(
        action.paused,
        mutationControl.value?.revision ?? null,
        action.paused ? '管理员紧急暂停' : '管理员确认恢复'
      );
      toast.success(action.paused ? '已暂停全部真实写入。' : '已恢复已验收真实写入。');
    } else if (action.kind === 'passkey-remove') {
      if (!control.removePasskey) throw new Error('当前后端不支持 Passkey 管理。');
      await control.removePasskey(action.credential.id);
      toast.success('Passkey 已移除。');
    } else {
      if (!control.regenerateRecoveryCodes) throw new Error('当前后端不支持恢复码管理。');
      recoveryCodes.value = await control.regenerateRecoveryCodes();
    }
    await refresh();
  } catch (cause: unknown) {
    error.value = userError(cause, '管理操作失败');
  } finally {
    loading.value = false;
  }
}

async function copyRecoveryCodes(): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(recoveryCodes.value.join('\n'));
    toast.success('恢复码已复制。');
  } catch {
    toast.error('复制失败，请手工选择。');
  }
}

function formatTime(value: number | null): string {
  return value === null ? '—' : new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function userError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback);
}
</script>

<template>
  <section class="mt-5 space-y-5" aria-labelledby="self-hosted-settings-title">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="self-hosted-settings-title" class="text-lg font-semibold">Cloudflare 自托管设置</h2>
        <p class="text-sm text-muted-foreground">密钥只在 Worker 内解密；管理接口只返回完整性和到期状态。</p>
      </div>
      <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
        <RefreshCw class="size-4" />刷新
      </Button>
    </div>

    <ErrorNotice v-if="error" :error="error" fallback="自托管设置操作失败" />

    <div class="grid gap-5 xl:grid-cols-3">
      <Card class="p-5">
        <div class="flex items-center justify-between gap-3">
          <h3 class="flex items-center gap-2 font-semibold"><Upload class="size-4" />Alibaba 凭据保险库</h3>
          <span
            class="rounded-full px-2 py-1 text-xs"
            :class="
              credentials?.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            "
          >
            {{ credentials?.configured ? '已配置' : '未配置' }}
          </span>
        </div>
        <dl class="mt-4 space-y-2 text-sm">
          <div class="flex justify-between gap-3">
            <dt class="text-muted-foreground">Access Token 到期</dt>
            <dd>{{ formatTime(credentials?.accessTokenExpiresTimeUtc ?? null) }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted-foreground">最近刷新错误</dt>
            <dd>{{ credentials?.lastRefreshErrorCode ?? '—' }}</dd>
          </div>
        </dl>
        <input
          ref="fileInput"
          class="hidden"
          type="file"
          accept="application/json,.json"
          @change="selectCredentialFile"
        />
        <div class="mt-4 flex flex-wrap gap-2">
          <Button size="sm" @click="acquisitionOpen = true"><Sparkles class="size-4" />一键连接</Button>
          <Button size="sm" @click="fileInput?.click()"
            ><Upload class="size-4" />导入 credentials.json</Button
          >
          <Button size="sm" variant="outline" :disabled="!credentials?.configured" @click="refreshCredential">
            刷新 Token
          </Button>
          <Button
            size="sm"
            variant="outline"
            :disabled="!credentials?.configured"
            @click="confirmation = { kind: 'credential-clear' }"
          >
            清空
          </Button>
        </div>
      </Card>

      <Card class="p-5">
        <div class="flex items-center justify-between gap-3">
          <h3 class="flex items-center gap-2 font-semibold"><Shield class="size-4" />真实写入急停</h3>
          <span
            class="rounded-full px-2 py-1 text-xs"
            :class="mutationControl?.paused ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'"
          >
            {{ mutationControl?.paused ? '全部暂停' : '白名单开放' }}
          </span>
        </div>
        <p class="mt-4 text-sm text-muted-foreground">
          急停优先级高于全部 operation flag。管理员也无法绕过未验收能力、资格限制或契约校验。
        </p>
        <Button
          class="mt-4 w-full"
          :variant="mutationControl?.paused ? 'default' : 'destructive'"
          @click="confirmation = { kind: 'pause', paused: !mutationControl?.paused }"
        >
          <PlayCircle v-if="mutationControl?.paused" class="size-4" />
          <PauseCircle v-else class="size-4" />
          {{ mutationControl?.paused ? '恢复已验收写入' : '暂停全部真实写入' }}
        </Button>
      </Card>

      <Card class="p-5">
        <div class="flex items-center justify-between gap-3">
          <h3 class="flex items-center gap-2 font-semibold"><KeyRound class="size-4" />我的 Passkey</h3>
          <Button size="sm" variant="outline" @click="addPasskey">新增</Button>
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
              移除
            </Button>
          </div>
        </div>
        <Button
          class="mt-4 w-full"
          size="sm"
          variant="outline"
          @click="confirmation = { kind: 'recovery-codes' }"
        >
          重新生成恢复码
        </Button>
      </Card>
    </div>

    <ConfirmActionDialog
      :open="confirmation !== null"
      :title="confirmationTitle"
      :description="confirmationDescription"
      :destructive="
        confirmation?.kind === 'credential-clear' || (confirmation?.kind === 'pause' && confirmation.paused)
      "
      :pending="loading"
      @update:open="confirmation = $event ? confirmation : null"
      @confirm="confirm"
    />

    <AlibabaCloudCredentialAcquisitionDialog v-model:open="acquisitionOpen" @completed="refresh" />

    <ModalDialog
      :open="recoveryCodes.length > 0"
      title="保存新的恢复码"
      description="旧恢复码已全部失效；新码关闭后不会再次显示。"
      size="md"
      @update:open="recoveryCodes = []"
    >
      <div class="grid grid-cols-2 gap-2 rounded-lg border bg-muted p-4 font-mono text-xs">
        <code v-for="code in recoveryCodes" :key="code" class="select-all break-all">{{ code }}</code>
      </div>
      <template #footer>
        <Button variant="outline" @click="copyRecoveryCodes"><Copy class="size-4" />复制</Button>
        <Button @click="recoveryCodes = []">我已保存</Button>
      </template>
    </ModalDialog>
  </section>
</template>
