<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check, Database, FlaskConical, KeyRound, ShieldCheck } from '@lucide/vue';

import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import { useServices } from '../lib/services';

const emit = defineEmits<{ ready: [] }>();
const { onboarding, mode } = useServices();
const visible = ref(false);
const acknowledged = ref(false);
const saving = ref(false);
const error = ref('');
const available = computed(() => mode === 'extension' && onboarding !== undefined);

onMounted(async () => {
  if (!available.value || !onboarding) {
    emit('ready');
    return;
  }
  try {
    visible.value = (await onboarding.load()).completedAt === null;
    if (!visible.value) emit('ready');
  } catch (reason: unknown) {
    visible.value = true;
    error.value = reason instanceof Error ? reason.message : '首次使用状态读取失败';
  }
});

async function finish(): Promise<void> {
  if (!onboarding || !acknowledged.value) return;
  saving.value = true;
  error.value = '';
  try {
    await onboarding.complete();
    visible.value = false;
    emit('ready');
  } catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : '首次使用状态保存失败';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Transition name="ov-modal">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <Card class="ov-modal-panel my-6 w-full max-w-2xl p-6 shadow-2xl">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">首次使用</p>
        <h1 id="onboarding-title" class="mt-2 text-2xl font-semibold">先确认数据与调用边界</h1>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          无需开放平台凭证即可查看能力目录和本地编辑；真实查询需要用户自己的凭证，图库分组管理、图片上传和外部图片转存已开放，其他真实写操作保持关闭。
        </p>
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-lg border p-4">
            <KeyRound class="size-5 text-emerald-700" />
            <p class="mt-2 font-medium">凭证在本机加密保存</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              App Key、App Secret 和 Access Token 使用用户口令加密后存入
              chrome.storage.local；口令不保存，内容脚本不能读取，扩展后台重启或连续空闲达到设置时长后需重新解锁。
            </p>
          </div>
          <div class="rounded-lg border p-4">
            <ShieldCheck class="size-5 text-emerald-700" />
            <p class="mt-2 font-medium">主机权限按用途申请</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              正式网关为必选权限；自定义网关和外部图片来源只在使用时向 Chrome 请求，可随时从设置撤销。
            </p>
          </div>
          <div class="rounded-lg border p-4">
            <FlaskConical class="size-5 text-emerald-700" />
            <p class="mt-2 font-medium">本地验证不等于平台授权</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              本地演示、契约验证和浏览器回归不代表国际站已授予接口权限；实际可用能力以当前账号、业务资格和平台响应为准。
            </p>
          </div>
          <div class="rounded-lg border p-4">
            <Database class="size-5 text-emerald-700" />
            <p class="mt-2 font-medium">本地数据可查看和清除</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              设置页提供数据清单与彻底清除入口；脱敏诊断仅保留在当前浏览器会话，不包含请求参数或响应正文。
            </p>
          </div>
        </div>
        <label class="mt-5 flex items-start gap-3 rounded-lg bg-muted p-4 text-sm leading-6">
          <input v-model="acknowledged" type="checkbox" class="mt-1 size-4 accent-emerald-600" />
          <span>我已理解接口可用性取决于账号权限与业务资格，并知晓本地数据、真实写入和主机权限的用途。</span>
        </label>
        <p v-if="error" class="mt-3 text-sm text-destructive">{{ error }}</p>
        <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
          <a class="text-sm text-emerald-700 underline" href="/privacy.html" target="_blank">查看隐私说明</a>
          <Button :disabled="!acknowledged || saving" @click="finish">
            <Check class="size-4" />开始使用
          </Button>
        </div>
      </Card>
    </div>
  </Transition>
</template>
