<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { Copy, Info, KeyRound, ShieldCheck, Sprout } from '@lucide/vue';

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/browser';
import type { ControlBootstrapStatus, ControlSession } from '@one-vegetable/core';

import { useServices } from '../lib/services';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';

const emit = defineEmits<{ authenticated: [session: ControlSession] }>();
const { control } = useServices();
const mode = ref<'login' | 'bootstrap' | 'recovery'>('login');
const username = ref('');
const password = ref('');
const bootstrapToken = ref('');
const recoveryCode = ref('');
const error = ref<unknown>(null);
const submitting = ref(false);
const bootstrapStatus = ref<ControlBootstrapStatus | null>(null);
const bootstrapStatusError = ref<unknown>(null);
const checkingBootstrapStatus = ref(true);
const pendingSession = ref<ControlSession | null>(null);
const recoveryCodes = ref<string[]>([]);
const bootstrapAvailable = computed(() => bootstrapStatus.value?.bootstrapAvailable === true);
const passkeyMode = computed(() => bootstrapStatus.value?.authenticationMode === 'passkey');
const webAuthnSupported = browserSupportsWebAuthn();

onMounted(refreshBootstrapStatus);

async function refreshBootstrapStatus(): Promise<void> {
  if (!control) return;
  checkingBootstrapStatus.value = true;
  bootstrapStatusError.value = null;
  try {
    bootstrapStatus.value = await control.bootstrapStatus();
    mode.value = bootstrapStatus.value.bootstrapAvailable ? 'bootstrap' : 'login';
  } catch (cause: unknown) {
    bootstrapStatus.value = null;
    mode.value = 'login';
    bootstrapStatusError.value = cause instanceof Error ? cause : new Error('无法确认管理员初始化状态');
  } finally {
    checkingBootstrapStatus.value = false;
  }
}

async function submit(): Promise<void> {
  if (!control) return;
  error.value = null;
  submitting.value = true;
  try {
    if (!passkeyMode.value) {
      const session =
        mode.value === 'login'
          ? await control.login(username.value, password.value)
          : await control.bootstrap({
              bootstrapToken: bootstrapToken.value,
              username: username.value,
              password: password.value,
              remark: '首个本地管理员'
            });
      emit('authenticated', session);
      return;
    }
    if (!webAuthnSupported)
      throw new Error('当前浏览器不支持 Passkey，请更换最新版 Chrome、Edge 或 Safari。');
    const passkeyControl = requiredPasskeyControl();
    if (mode.value === 'login') {
      const ceremony = await passkeyControl.passkeyLoginOptions();
      const response = await startAuthentication({
        optionsJSON: ceremony.options as unknown as PublicKeyCredentialRequestOptionsJSON
      });
      emit('authenticated', await passkeyControl.passkeyLoginVerify(ceremony.challengeId, response));
      return;
    }
    const ceremony =
      mode.value === 'bootstrap'
        ? await passkeyControl.passkeyBootstrapOptions(bootstrapToken.value, username.value)
        : await passkeyControl.passkeyRecoveryOptions(username.value, recoveryCode.value);
    const response = await startRegistration({
      optionsJSON: ceremony.options as unknown as PublicKeyCredentialCreationOptionsJSON
    });
    const result =
      mode.value === 'bootstrap'
        ? await passkeyControl.passkeyBootstrapVerify(ceremony.challengeId, response, '首个 Passkey')
        : await passkeyControl.passkeyRecoveryVerify(ceremony.challengeId, response, '恢复设备');
    pendingSession.value = result.session;
    recoveryCodes.value = result.recoveryCodes;
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause : new Error('认证失败');
  } finally {
    submitting.value = false;
  }
}

async function copyRecoveryCodes(): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(recoveryCodes.value.join('\n'));
  } catch {
    error.value = new Error('复制失败，请手工选择并保存恢复码。');
  }
}

function finishRecoveryCodeStep(): void {
  if (pendingSession.value) emit('authenticated', pendingSession.value);
}

function requiredPasskeyControl() {
  if (
    !control?.passkeyBootstrapOptions ||
    !control.passkeyBootstrapVerify ||
    !control.passkeyLoginOptions ||
    !control.passkeyLoginVerify ||
    !control.passkeyRecoveryOptions ||
    !control.passkeyRecoveryVerify
  ) {
    throw new Error('当前客户端版本不支持 Passkey，请刷新页面。');
  }
  return {
    passkeyBootstrapOptions: control.passkeyBootstrapOptions.bind(control),
    passkeyBootstrapVerify: control.passkeyBootstrapVerify.bind(control),
    passkeyLoginOptions: control.passkeyLoginOptions.bind(control),
    passkeyLoginVerify: control.passkeyLoginVerify.bind(control),
    passkeyRecoveryOptions: control.passkeyRecoveryOptions.bind(control),
    passkeyRecoveryVerify: control.passkeyRecoveryVerify.bind(control)
  };
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-slate-950 p-5">
    <Card class="w-full max-w-lg border-slate-800 bg-slate-900 text-slate-100">
      <section v-if="pendingSession" class="space-y-5 p-7">
        <div class="flex items-center gap-3">
          <span class="grid size-11 place-items-center rounded-xl bg-emerald-500 text-slate-950">
            <ShieldCheck class="size-6" />
          </span>
          <div>
            <h1 class="text-lg font-semibold">保存一次性恢复码</h1>
            <p class="text-xs text-slate-400">设备丢失或域名更换时用于注册新 Passkey</p>
          </div>
        </div>
        <div
          class="grid grid-cols-2 gap-2 rounded-lg border border-slate-700 bg-slate-950 p-4 font-mono text-xs"
        >
          <code v-for="code in recoveryCodes" :key="code" class="select-all break-all">{{ code }}</code>
        </div>
        <p class="text-xs text-amber-300">
          这些恢复码只显示一次，每个只能使用一次。请保存到密码管理器，不要放入项目备注或截图。
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" @click="copyRecoveryCodes">
            <Copy class="size-4" />复制恢复码
          </Button>
          <Button type="button" @click="finishRecoveryCodeStep">我已安全保存，进入工作台</Button>
        </div>
      </section>

      <form v-else class="space-y-5 p-7" @submit.prevent="submit">
        <div class="flex items-center gap-3">
          <span class="grid size-11 place-items-center rounded-xl bg-emerald-500 text-slate-950">
            <Sprout class="size-6" />
          </span>
          <div>
            <h1 class="text-lg font-semibold">登录运营工作台</h1>
            <p class="text-xs text-slate-400">
              {{ passkeyMode ? 'Cloudflare 自托管 · Passkey' : '本地账号 · 不透明会话 · ABAC' }}
            </p>
          </div>
        </div>

        <div class="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
          <div class="flex gap-2">
            <Info class="mt-0.5 size-4 shrink-0 text-emerald-400" />
            <p>
              这是 oneVegetable 工作台身份，不是 Alibaba 国际站登录账号。Alibaba OpenAPI
              凭据需在登录后的管理后台导入。
            </p>
          </div>
        </div>

        <div
          v-if="passkeyMode && !bootstrapAvailable"
          class="grid grid-cols-2 rounded-lg bg-slate-950 p-1 text-sm"
        >
          <button
            type="button"
            class="rounded-md px-3 py-2 transition-colors"
            :class="mode === 'login' ? 'bg-slate-800 text-white' : 'text-slate-400'"
            @click="mode = 'login'"
          >
            Passkey 登录
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2 transition-colors"
            :class="mode === 'recovery' ? 'bg-slate-800 text-white' : 'text-slate-400'"
            @click="mode = 'recovery'"
          >
            恢复访问
          </button>
        </div>

        <div
          v-else-if="bootstrapAvailable && !passkeyMode"
          class="grid grid-cols-2 rounded-lg bg-slate-950 p-1 text-sm"
        >
          <button
            type="button"
            class="rounded-md px-3 py-2"
            :class="mode === 'login' ? 'bg-slate-800 text-white' : 'text-slate-400'"
            @click="mode = 'login'"
          >
            登录
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2"
            :class="mode === 'bootstrap' ? 'bg-slate-800 text-white' : 'text-slate-400'"
            @click="mode = 'bootstrap'"
          >
            初始化管理员
          </button>
        </div>

        <p v-if="checkingBootstrapStatus" class="text-xs text-slate-500">正在检查初始化状态…</p>
        <p
          v-else-if="bootstrapStatus?.initialized && mode !== 'recovery'"
          class="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400"
        >
          工作台已经初始化，请使用已登记的{{ passkeyMode ? ' Passkey' : '本地账号' }}登录。
        </p>
        <p
          v-else-if="bootstrapStatus && !bootstrapStatus.bootstrapTokenConfigured"
          class="rounded-md border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200"
        >
          工作台尚未初始化，且服务端未配置一次性管理员引导令牌。
        </p>
        <ErrorNotice
          v-else-if="bootstrapStatusError"
          :error="bootstrapStatusError"
          fallback="无法确认管理员初始化状态"
          compact
        />

        <label v-if="mode === 'bootstrap'" class="block space-y-1.5 text-sm">
          <span>管理员引导令牌</span>
          <Input v-model="bootstrapToken" name="bootstrapToken" type="password" autocomplete="off" required />
        </label>
        <label v-if="mode !== 'login' || !passkeyMode" class="block space-y-1.5 text-sm">
          <span>工作台用户名</span>
          <Input v-model="username" name="username" autocomplete="username webauthn" required />
        </label>
        <label v-if="mode === 'recovery'" class="block space-y-1.5 text-sm">
          <span>一次性恢复码</span>
          <Input v-model="recoveryCode" name="recoveryCode" autocomplete="off" required />
        </label>
        <label v-if="!passkeyMode" class="block space-y-1.5 text-sm">
          <span>工作台密码</span>
          <Input
            v-model="password"
            name="password"
            type="password"
            :autocomplete="mode === 'bootstrap' ? 'new-password' : 'current-password'"
            required
          />
          <span class="text-xs text-slate-500">至少 12 个字符左右，建议使用密码管理器生成</span>
        </label>
        <ErrorNotice v-if="error" :error="error" fallback="认证失败" compact />
        <Button class="w-full" type="submit" :disabled="submitting || checkingBootstrapStatus">
          <KeyRound class="size-4" />
          {{
            submitting
              ? '请按浏览器提示操作…'
              : passkeyMode
                ? mode === 'bootstrap'
                  ? '创建管理员 Passkey'
                  : mode === 'recovery'
                    ? '使用恢复码登记新 Passkey'
                    : '使用 Passkey 登录'
                : mode === 'login'
                  ? '登录'
                  : '创建管理员'
          }}
        </Button>
      </form>
    </Card>
  </main>
</template>
