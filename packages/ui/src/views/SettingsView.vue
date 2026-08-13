<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { KeyRound, Save, ShieldCheck } from '@lucide/vue';

import { ALIBABA_GATEWAY, type GatewaySettings, type SignMethod } from '@one-vegetable/core';

import PageHeader from '../components/PageHeader.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';

const { settings, mode } = useServices();
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

onMounted(async () => {
  model.value = await settings.load();
});

async function save(): Promise<void> {
  saving.value = true;
  feedback.value = '';
  try {
    await settings.save(model.value);
    feedback.value =
      mode === 'mock' ? 'Mock 设置已保存在本地浏览器。' : '设置已安全写入 chrome.storage.local。';
  } catch (error: unknown) {
    feedback.value = error instanceof Error ? error.message : '设置保存失败';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageHeader
    title="连接设置"
    description="凭证不会进入页面请求；扩展模式下仅由 MV3 service worker 读取并签名。"
  />
  <div class="grid max-w-3xl gap-4">
    <Card class="p-5">
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
        /></label>
        <label class="text-sm font-medium sm:col-span-2"
          >Access Token<Input
            v-model="model.accessToken"
            class="mt-2"
            type="password"
            autocomplete="new-password"
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
      <p v-if="feedback" class="mt-4 text-sm text-emerald-700">{{ feedback }}</p>
      <Button class="mt-4" :disabled="saving" @click="save"><Save class="size-4" />保存设置</Button>
    </Card>
    <Card class="flex items-start gap-3 border-emerald-200 bg-emerald-50 p-5 text-emerald-900"
      ><ShieldCheck class="mt-0.5 size-5 shrink-0" />
      <div>
        <p class="font-medium">安全边界</p>
        <p class="mt-1 text-sm leading-6">
          浏览器扩展无法从根本上隐藏 App Secret；当前实现减少页面暴露面，并为未来迁移到 BFF 保留同一
          GatewayClient 契约。
        </p>
      </div></Card
    >
  </div>
</template>
