<script setup lang="ts">
import { ref } from 'vue';
import { KeyRound, Sprout } from '@lucide/vue';

import type { ControlSession } from '@one-vegetable/core';

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
            <h1 class="text-lg font-semibold">一根青菜 BFF</h1>
            <p class="text-xs text-slate-400">本地账号 · 不透明会话 · ABAC</p>
          </div>
        </div>

        <div class="grid grid-cols-2 rounded-lg bg-slate-950 p-1 text-sm">
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

        <label v-if="mode === 'bootstrap'" class="block space-y-1.5 text-sm">
          <span>一次性 Bootstrap Token</span>
          <Input v-model="bootstrapToken" type="password" autocomplete="off" />
        </label>
        <label class="block space-y-1.5 text-sm">
          <span>用户名</span>
          <Input v-model="username" autocomplete="username" />
        </label>
        <label class="block space-y-1.5 text-sm">
          <span>密码</span>
          <Input v-model="password" type="password" autocomplete="current-password" />
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
