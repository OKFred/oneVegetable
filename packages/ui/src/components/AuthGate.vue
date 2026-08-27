<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Info, KeyRound, Sprout } from '@lucide/vue';

import type { ControlBootstrapStatus, ControlSession } from '@one-vegetable/core';

import { useServices } from '../lib/services';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';

const emit = defineEmits<{ authenticated: [session: ControlSession] }>();
const { control } = useServices();
const mode = ref<'login' | 'bootstrap'>('login');
const username = ref('');
const password = ref('');
const bootstrapToken = ref('');
const error = ref('');
const submitting = ref(false);
const bootstrapStatus = ref<ControlBootstrapStatus | null>(null);
const bootstrapStatusError = ref('');
const checkingBootstrapStatus = ref(true);
const bootstrapAvailable = computed(() => bootstrapStatus.value?.bootstrapAvailable === true);

onMounted(refreshBootstrapStatus);

async function refreshBootstrapStatus(): Promise<void> {
  if (!control) return;
  checkingBootstrapStatus.value = true;
  bootstrapStatusError.value = '';
  try {
    bootstrapStatus.value = await control.bootstrapStatus();
    if (!bootstrapStatus.value.bootstrapAvailable) mode.value = 'login';
  } catch (cause: unknown) {
    bootstrapStatus.value = null;
    mode.value = 'login';
    bootstrapStatusError.value = cause instanceof Error ? cause.message : '无法确认管理员初始化状态';
  } finally {
    checkingBootstrapStatus.value = false;
  }
}

async function submit(): Promise<void> {
  if (!control) return;
  error.value = '';
  submitting.value = true;
  try {
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
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : '认证失败';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-slate-950 p-5">
    <Card class="w-full max-w-md border-slate-800 bg-slate-900 text-slate-100">
      <form class="space-y-5 p-7" @submit.prevent="submit">
        <div class="flex items-center gap-3">
          <span class="grid size-11 place-items-center rounded-xl bg-emerald-500 text-slate-950">
            <Sprout class="size-6" />
          </span>
          <div>
            <h1 class="text-lg font-semibold">登录运营工作台</h1>
            <p class="text-xs text-slate-400">工作台本地账号 · 不透明会话 · ABAC</p>
          </div>
        </div>

        <div class="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
          <div class="flex gap-2">
            <Info class="mt-0.5 size-4 shrink-0 text-emerald-400" />
            <p>
              此处只接受本应用的工作台账号，不是 Alibaba 国际站登录账号。Alibaba OpenAPI 的 AppKey、AppSecret
              和 Token 由服务端环境变量或本地授权包管理，登录后只能查看脱敏连接状态。
            </p>
          </div>
        </div>

        <div v-if="bootstrapAvailable" class="grid grid-cols-2 rounded-lg bg-slate-950 p-1 text-sm">
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

        <p v-if="checkingBootstrapStatus" class="text-xs text-slate-500">正在检查本地初始化状态…</p>
        <p
          v-else-if="bootstrapStatus?.initialized"
          class="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400"
        >
          工作台已经初始化，请使用已创建的本地账号登录。
        </p>
        <p
          v-else-if="bootstrapStatus && !bootstrapStatus.bootstrapTokenConfigured"
          class="rounded-md border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200"
        >
          工作台尚未初始化，且服务端未配置一次性 Bootstrap Token。请先配置服务端环境变量。
        </p>
        <p
          v-else-if="bootstrapStatusError"
          class="rounded-md border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200"
        >
          无法确认管理员初始化状态，初始化入口已暂时隐藏：{{ bootstrapStatusError }}
        </p>

        <label v-if="mode === 'bootstrap'" class="block space-y-1.5 text-sm">
          <span>一次性 Bootstrap Token</span>
          <Input v-model="bootstrapToken" name="bootstrapToken" type="password" autocomplete="off" required />
        </label>
        <label class="block space-y-1.5 text-sm">
          <span>工作台用户名</span>
          <Input v-model="username" name="username" autocomplete="username" required />
        </label>
        <label class="block space-y-1.5 text-sm">
          <span>工作台密码</span>
          <Input
            v-model="password"
            name="password"
            type="password"
            :autocomplete="mode === 'bootstrap' ? 'new-password' : 'current-password'"
            required
          />
          <span class="text-xs text-slate-500">12–256 个 UTF-8 字节</span>
        </label>
        <p v-if="error" class="rounded-md border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
          {{ error }}
        </p>
        <Button class="w-full" type="submit" :disabled="submitting">
          <KeyRound class="size-4" />{{ submitting ? '处理中…' : mode === 'login' ? '登录' : '创建管理员' }}
        </Button>
      </form>
    </Card>
  </main>
</template>
