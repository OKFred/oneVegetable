<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  LoaderCircle,
  Puzzle,
  ShieldCheck
} from '@lucide/vue';

import type {
  AlibabaCredentialAcquisitionExtensionFallbackReason,
  AlibabaCredentialAcquisitionState
} from '@one-vegetable/core';

import { useServices } from '../lib/services';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  completed: [];
}>();

const { control } = useServices();
const account = ref('');
const password = ref('');
const callbackUrl = ref('');
const state = ref<AlibabaCredentialAcquisitionState | null>(null);
const manualExtensionGuide = ref(false);
const busy = ref(false);
const error = ref<unknown>(null);
let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

type DialogViewState =
  AlibabaCredentialAcquisitionState | { status: 'form' } | { status: 'manual-extension' };

const viewState = computed<DialogViewState>(() => {
  if (manualExtensionGuide.value) return { status: 'manual-extension' };
  return state.value ?? { status: 'form' };
});

const activeJobId = computed(() => {
  const current = state.value;
  return current?.status === 'running' ||
    current?.status === 'selection-required' ||
    current?.status === 'callback-confirmation-required'
    ? current.jobId
    : null;
});

async function start(): Promise<void> {
  if (!control?.startAlibabaCredentialAcquisition || !account.value.trim() || !password.value) return;
  busy.value = true;
  error.value = null;
  state.value = null;
  try {
    const next = await control.startAlibabaCredentialAcquisition({
      account: account.value.trim(),
      password: password.value,
      callbackUrl: callbackUrl.value.trim() || null
    });
    acceptState(next);
  } catch (cause: unknown) {
    error.value = userError(cause, '云端自动获取暂时失败');
  } finally {
    account.value = '';
    password.value = '';
    busy.value = false;
  }
}

async function selectApplication(applicationId: string): Promise<void> {
  const jobId = activeJobId.value;
  if (!control?.continueAlibabaCredentialAcquisition || !jobId) return;
  await continueJob(jobId, { type: 'select-application', applicationId });
}

async function confirmCallback(confirmed: boolean): Promise<void> {
  const jobId = activeJobId.value;
  if (!control?.continueAlibabaCredentialAcquisition || !jobId) return;
  await continueJob(jobId, { type: 'confirm-callback-change', confirmed });
}

async function continueJob(
  jobId: string,
  command:
    | { type: 'select-application'; applicationId: string }
    | { type: 'confirm-callback-change'; confirmed: boolean }
): Promise<void> {
  if (!control?.continueAlibabaCredentialAcquisition) return;
  busy.value = true;
  error.value = null;
  try {
    const next = await control.continueAlibabaCredentialAcquisition(jobId, command);
    acceptState(next);
  } catch (cause: unknown) {
    error.value = userError(cause, '凭据获取流程无法继续');
  } finally {
    busy.value = false;
  }
}

function acceptState(next: AlibabaCredentialAcquisitionState): void {
  state.value = next;
  clearPoll();
  if (next.status === 'running') schedulePoll(next.jobId);
  if (next.status === 'completed') emit('completed');
}

function schedulePoll(jobId: string): void {
  clearPoll();
  pollTimer = globalThis.setTimeout(() => void poll(jobId), 1_500);
}

async function poll(jobId: string): Promise<void> {
  if (!control?.alibabaCredentialAcquisitionStatus || !props.open) return;
  try {
    const next = await control.alibabaCredentialAcquisitionStatus(jobId);
    acceptState(next);
  } catch (cause: unknown) {
    error.value = userError(cause, '凭据获取状态读取失败');
  }
}

async function close(): Promise<void> {
  clearPoll();
  const jobId = activeJobId.value;
  emit('update:open', false);
  state.value = null;
  error.value = null;
  account.value = '';
  password.value = '';
  callbackUrl.value = '';
  manualExtensionGuide.value = false;
  if (control?.cancelAlibabaCredentialAcquisition && jobId) {
    await control.cancelAlibabaCredentialAcquisition(jobId).catch(() => undefined);
  }
}

function clearPoll(): void {
  if (pollTimer !== null) globalThis.clearTimeout(pollTimer);
  pollTimer = null;
}

function fallbackMessage(reason: AlibabaCredentialAcquisitionExtensionFallbackReason): string {
  const messages: Record<AlibabaCredentialAcquisitionExtensionFallbackReason, string> = {
    'browser-unavailable': '云端浏览器当前不可用。',
    'browser-quota-exhausted': '今日 Browser Run 免费额度不足。',
    'bot-rejected': 'Alibaba 将云端浏览器识别为自动化访问。',
    captcha: 'Alibaba 要求完成验证码。',
    slider: 'Alibaba 要求完成滑块验证。',
    mfa: 'Alibaba 要求完成二次验证。',
    'secret-verification': '查看 App Secret 需要安全确认。',
    'automation-layout-unsupported': 'Alibaba 页面布局或授权协议需要人工确认。',
    'session-expired': '云端浏览器会话已过期。'
  };
  return messages[reason];
}

function userError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback);
}

function openChromeStore(): void {
  globalThis.open(
    'https://chromewebstore.google.com/detail/aepfdoldflokikbbcpnfifkacpfakmjc',
    '_blank',
    'noopener,noreferrer'
  );
}

onBeforeUnmount(clearPoll);
</script>

<template>
  <ModalDialog
    :open="open"
    title="一键连接 Alibaba"
    description="优先用 Cloudflare Browser Run 尝试；安全验证出现时改用正式版 Chrome 插件。"
    size="lg"
    @update:open="$event ? emit('update:open', true) : void close()"
  >
    <div class="space-y-5">
      <ErrorNotice v-if="error" :error="error" fallback="凭据获取失败" />

      <form v-if="viewState.status === 'form'" class="space-y-4" @submit.prevent="start">
        <div
          class="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100"
        >
          <p class="flex items-center gap-2 font-medium"><ShieldCheck class="size-4" />敏感信息处理</p>
          <p class="mt-1 leading-6">
            账号和密码只用于当前 HTTPS 请求和临时浏览器内存，不写入
            D1、日志、审计或截图。系统只复用已有应用，不会创建应用、申请权限或接受协议。
          </p>
          <p class="mt-2 leading-6">
            Browser Run 免费额度有限；遇到验证码、滑块或二次验证时，建议直接使用本机插件。
          </p>
        </div>

        <label class="grid gap-1.5 text-sm">
          <span class="font-medium">Alibaba 登录账号</span>
          <Input v-model="account" autocomplete="username" maxlength="512" required />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span class="font-medium">Alibaba 登录密码</span>
          <Input
            v-model="password"
            type="password"
            autocomplete="current-password"
            maxlength="1024"
            required
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span class="font-medium">Callback URL（可选）</span>
          <Input v-model="callbackUrl" type="url" placeholder="留空则保留应用现值" />
          <span class="text-xs text-muted-foreground"
            >不会默认写入 example.com；显式修改前会再次展示新旧地址。</span
          >
        </label>

        <div class="flex flex-wrap justify-between gap-3 border-t pt-4">
          <Button type="button" variant="outline" @click="close">取消</Button>
          <div class="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" @click="manualExtensionGuide = true">
              <Puzzle class="size-4" />使用本机插件
            </Button>
            <Button type="submit" :disabled="busy || !account.trim() || !password">
              <LoaderCircle v-if="busy" class="size-4 animate-spin" />
              <Cloud v-else class="size-4" />
              {{ busy ? '正在安全连接…' : '云端自动获取' }}
            </Button>
          </div>
        </div>
      </form>

      <div v-else-if="viewState.status === 'running'" class="py-10 text-center">
        <LoaderCircle class="mx-auto size-8 animate-spin text-primary" />
        <p class="mt-3 font-medium">正在读取应用并完成 OAuth 授权…</p>
        <p class="mt-1 text-sm text-muted-foreground">最长保留 10 分钟，出现安全验证会自动切换插件方案。</p>
      </div>

      <div v-else-if="viewState.status === 'selection-required'" class="space-y-3">
        <div>
          <h3 class="font-semibold">选择已有应用</h3>
          <p class="text-sm text-muted-foreground">检测到多个应用。这里只显示名称、状态和 AppKey 尾号。</p>
        </div>
        <button
          v-for="application in viewState.applications"
          :key="application.applicationId"
          type="button"
          class="flex w-full items-center justify-between rounded-lg border bg-card p-4 text-left transition hover:border-primary hover:bg-accent disabled:opacity-60"
          :disabled="busy"
          @click="selectApplication(application.applicationId)"
        >
          <span>
            <span class="block font-medium">{{ application.appName }}</span>
            <span class="mt-1 block text-xs text-muted-foreground">
              {{ application.source === 'legacy-crosstrade' ? '旧版应用中心' : 'Application center' }} ·
              {{ application.status || '状态未知' }}
            </span>
          </span>
          <code class="rounded bg-muted px-2 py-1 text-xs">••••{{ application.appKeySuffix }}</code>
        </button>
      </div>

      <div v-else-if="viewState.status === 'callback-confirmation-required'" class="space-y-4">
        <div
          class="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
        >
          <p class="flex items-center gap-2 font-medium"><AlertTriangle class="size-4" />确认修改 Callback</p>
          <dl class="mt-3 grid gap-3 text-sm">
            <div>
              <dt class="text-muted-foreground">当前地址</dt>
              <dd class="break-all font-mono text-xs">{{ viewState.currentUrl }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground">新地址</dt>
              <dd class="break-all font-mono text-xs">{{ viewState.requestedUrl }}</dd>
            </div>
          </dl>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="confirmCallback(false)">保留现有地址</Button>
          <Button :disabled="busy" @click="confirmCallback(true)">确认修改并继续</Button>
        </div>
      </div>

      <div
        v-else-if="viewState.status === 'manual-extension' || viewState.status === 'extension-required'"
        class="space-y-4"
      >
        <div class="rounded-lg border p-5">
          <p class="flex items-center gap-2 font-semibold"><Puzzle class="size-5" />改用本机 Chrome 插件</p>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">
            <template v-if="viewState.status === 'extension-required'">
              {{ fallbackMessage(viewState.reasonCode) }}
            </template>
            <template v-else>本机插件不会占用 Browser Run 额度。</template>
            插件会复用你当前 Chrome 的 Alibaba 登录态，不读取网站密码，并允许你直接完成人机验证。
          </p>
        </div>
        <ol class="list-decimal space-y-2 pl-5 text-sm">
          <li>安装或打开 oneVegetable 正式版插件。</li>
          <li>在插件设置中点击“获取开放平台凭证”，按向导完成授权。</li>
          <li>导出 credentialInfo.json，再回到本页使用“导入凭据”加密保存。</li>
        </ol>
        <div class="flex flex-wrap justify-end gap-2">
          <Button
            v-if="viewState.status === 'manual-extension'"
            variant="outline"
            @click="manualExtensionGuide = false"
            >返回</Button
          >
          <Button v-else variant="outline" @click="close">关闭</Button>
          <Button @click="openChromeStore">打开 Chrome 商店<ExternalLink class="size-4" /></Button>
        </div>
      </div>

      <div v-else-if="viewState.status === 'completed'" class="py-6 text-center">
        <CheckCircle2 class="mx-auto size-10 text-emerald-600" />
        <h3 class="mt-3 text-lg font-semibold">凭据已加密保存</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ viewState.credential.appName }} · AppKey 尾号
          {{ viewState.credential.appKeySuffix }}；页面不会回显密钥。
        </p>
        <Button class="mt-5" @click="close">完成</Button>
      </div>

      <div v-else-if="viewState.status === 'failed'" class="space-y-4 py-6 text-center">
        <AlertTriangle class="mx-auto size-9 text-destructive" />
        <h3 class="font-semibold">自动获取未完成</h3>
        <p class="text-sm text-muted-foreground">{{ viewState.error.message }}</p>
        <Button variant="outline" @click="state = null">重新开始</Button>
      </div>
    </div>
  </ModalDialog>
</template>
