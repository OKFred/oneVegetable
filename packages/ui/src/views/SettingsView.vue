<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Download, KeyRound, RotateCcw, Save, ShieldCheck, Trash2 } from '@lucide/vue';

import {
  ALIBABA_GATEWAY,
  type DiagnosticsSnapshot,
  type GatewaySettings,
  type SignMethod
} from '@one-vegetable/core';

import PageHeader from '../components/PageHeader.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';

const { gateway, settings, mode } = useServices();
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
const lastDiagnosticError = computed(() =>
  diagnostics.value?.entries.findLast((entry) => entry.outcome === 'error')
);

onMounted(async () => {
  const [storedSettings] = await Promise.all([settings.load(), refreshDiagnostics()]);
  model.value = storedSettings;
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
        <span class="rounded-full bg-muted px-3 py-1 text-xs">
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
  </div>
</template>
