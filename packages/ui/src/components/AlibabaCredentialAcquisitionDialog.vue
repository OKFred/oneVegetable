<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CheckCircle2, Download, ExternalLink, KeyRound, LoaderCircle, Save, ShieldAlert } from '@lucide/vue';

import type { AlibabaCredentialAcquisitionState, CredentialVaultStatus } from '@one-vegetable/core';

import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import { useServices } from '../lib/services';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  saved: [status: CredentialVaultStatus];
}>();

const { alibabaCredentialAcquisition, vault } = useServices();
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
    if (open) void refreshVaultStatus();
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
      error.value = new Error('本机保护口令至少输入 6 位');
      return;
    }
    if (vaultPassphrase.value !== vaultPassphraseConfirmation.value) {
      error.value = new Error('两次输入的本机保护口令不一致');
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
    feedback.value = '凭据已在插件中加密保存。';
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
    feedback.value = 'credentialInfo.json 已下载；请妥善保管并在导入后删除明文文件。';
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function requestClose(): Promise<void> {
  stopPolling();
  if (alibabaCredentialAcquisition && jobId.value) {
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
    title="获取开放平台凭证"
    description="复用当前 Chrome 的 Alibaba 登录态；插件不会读取或保存网站密码。"
    size="lg"
    @update:open="requestClose"
  >
    <div class="grid gap-4">
      <div class="rounded-lg border bg-muted/35 p-4 text-sm leading-6">
        <p class="font-medium">向导只复用已有应用</p>
        <p class="mt-1 text-muted-foreground">
          启动后会打开 Alibaba 应用中心。若尚未登录、出现滑块、验证码、MFA
          或密钥查看确认，请直接在打开的标签页中完成；插件不会绕过安全验证，也不会创建应用或接受平台协议。
        </p>
      </div>

      <template v-if="state === null">
        <label class="text-sm font-medium">
          Callback URL（可选）
          <Input
            v-model="callbackUrl"
            class="mt-2"
            type="url"
            placeholder="留空则保留应用现有 Callback"
            autocomplete="off"
          />
        </label>
        <p class="text-xs leading-5 text-muted-foreground">
          只有显式填写并确认后才会修改应用配置；不会默认写入 example.com。
        </p>
        <Button :disabled="busy || !alibabaCredentialAcquisition" @click="start">
          <ExternalLink class="size-4" />打开 Alibaba 并开始
        </Button>
      </template>

      <div v-else-if="state.status === 'running'" class="rounded-lg border p-5 text-center">
        <LoaderCircle class="mx-auto size-7 animate-spin text-primary" />
        <p class="mt-3 font-medium">正在等待 Alibaba 页面完成当前步骤</p>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          请查看刚打开的 Alibaba 标签页并完成登录、验证码、密钥查看或 OAuth 授权。完成后向导会自动继续。
        </p>
        <Button class="mt-4" variant="outline" :disabled="busy" @click="refreshStatus"> 立即检查 </Button>
      </div>

      <div v-else-if="state.status === 'selection-required'" class="grid gap-3">
        <div>
          <h3 class="font-medium">选择要复用的应用</h3>
          <p class="mt-1 text-sm text-muted-foreground">只展示 AppKey 尾号，不在页面返回完整密钥。</p>
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
            {{ application.source }} · AppKey 尾号 {{ application.appKeySuffix }} ·
            {{ application.status || '状态未知' }}
          </span>
        </button>
      </div>

      <div v-else-if="state.status === 'callback-confirmation-required'" class="grid gap-4">
        <div class="rounded-lg border p-4 text-sm leading-6">
          <p class="font-medium">{{ callbackChanged ? '确认 Callback 变更' : '确认 OAuth Callback' }}</p>
          <dl class="mt-3 grid gap-2 text-xs">
            <div>
              <dt class="text-muted-foreground">当前地址</dt>
              <dd class="break-all font-mono">{{ state.currentUrl }}</dd>
            </div>
            <div v-if="callbackChanged">
              <dt class="text-muted-foreground">请求修改为</dt>
              <dd class="break-all font-mono">{{ state.requestedUrl }}</dd>
            </div>
          </dl>
        </div>
        <p class="text-xs leading-5 text-muted-foreground">
          下一步 Chrome 会仅为实际 Callback 域名请求临时站点权限，用于捕获本次 OAuth code 并校验 state。
        </p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button v-if="callbackChanged" variant="outline" :disabled="busy" @click="confirmCallback(false)">
            保留现值并继续
          </Button>
          <Button :disabled="busy" @click="confirmCallback(callbackChanged)">
            {{ callbackChanged ? '确认修改并继续' : '继续授权' }}
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
              <p class="font-medium">凭据获取完成</p>
              <p class="mt-1 text-sm">
                {{ completed?.appName }} · AppKey 尾号 {{ completed?.appKeySuffix }} · 权限
                {{ completed?.permissions.total ?? 0 }} 项
              </p>
            </div>
          </div>
        </div>

        <div class="rounded-lg border p-4">
          <div class="flex items-center gap-2">
            <KeyRound class="size-4 text-primary" />
            <h3 class="font-medium">加密保存到插件</h3>
          </div>
          <p v-if="vaultStatus?.state === 'locked'" class="mt-2 text-sm text-amber-700 dark:text-amber-300">
            本机凭证当前已锁定。请关闭向导，在设置页解锁后重新执行获取流程。
          </p>
          <div v-else-if="vaultStatus?.state === 'empty'" class="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              v-model="vaultPassphrase"
              type="password"
              autocomplete="new-password"
              placeholder="设置本机保护口令（至少 6 位）"
            />
            <Input
              v-model="vaultPassphraseConfirmation"
              type="password"
              autocomplete="new-password"
              placeholder="再次输入保护口令"
            />
          </div>
          <Button
            class="mt-3"
            :disabled="busy || vaultStatus?.state === 'locked' || vaultStatus?.state === 'invalid'"
            @click="saveToVault"
          >
            <Save class="size-4" />加密保存
          </Button>
        </div>

        <div
          class="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/25"
        >
          <div class="flex items-start gap-2">
            <ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium">导出明文 credentialInfo.json</p>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                文件包含 App Secret、Access Token 和 Refresh
                Token，可导入自托管后端；导入后请立即删除并避免同步到网盘或 Git。
              </p>
              <label class="mt-3 flex cursor-pointer items-start gap-2 text-xs">
                <input v-model="plaintextAcknowledged" class="mt-0.5" type="checkbox" />
                <span>我知道该文件包含明文密钥，并会妥善保管。</span>
              </label>
              <Button
                class="mt-3"
                variant="outline"
                :disabled="busy || !plaintextAcknowledged"
                @click="exportCredentialBundle"
              >
                <Download class="size-4" />导出 credentialInfo.json
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="state.status === 'failed'" class="grid gap-3">
        <ErrorNotice :error="state.error" fallback="Alibaba 凭据获取失败" compact />
        <Button variant="outline" @click="reset">重新开始</Button>
      </div>

      <div v-else-if="state.status === 'extension-required'" class="rounded-lg border p-4 text-sm">
        当前已经在正式插件中运行，请重新开始本机向导。原因：{{ state.reasonCode }}
      </div>

      <p
        v-if="feedback"
        class="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
      >
        {{ feedback }}
      </p>
      <ErrorNotice v-if="error" :error="error" fallback="凭证向导操作失败" compact />
    </div>

    <template #footer>
      <div class="flex justify-end">
        <Button variant="outline" :disabled="busy" @click="requestClose">关闭</Button>
      </div>
    </template>
  </ModalDialog>
</template>
