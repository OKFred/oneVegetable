<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Copy, ExternalLink, Link2, RefreshCw, Unplug } from '@lucide/vue';
import { toast } from 'vue-sonner';

import type { ExtensionSocialBackendStatus } from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';

const { extensionSocialBackend, socialPublishing } = useServices();
const status = ref<ExtensionSocialBackendStatus | null>(null);
const baseUrl = ref('');
const deviceName = ref('Chrome 插件');
const busy = ref(false);
const error = ref<unknown>(null);
const disconnectConfirmation = ref(false);

const stateLabel = computed(() => {
  if (status.value === null) return '正在读取';
  if (status.value.state === 'paired') return '已配对';
  if (status.value.state === 'pending') return '等待管理员批准';
  if (status.value.state === 'expired') return '已失效';
  return '未配置';
});
const formattedPairingCode = computed(() =>
  (status.value?.pairingCode ?? '').replace(/(.{4})(?=.)/gu, '$1-')
);
const adminUrl = computed(() => (status.value?.baseUrl ? `${status.value.baseUrl}/#/admin` : ''));

onMounted(refreshStatus);

async function refreshStatus(): Promise<void> {
  if (!extensionSocialBackend) return;
  busy.value = true;
  error.value = null;
  try {
    const current = await extensionSocialBackend.status();
    status.value = current;
    if (current.baseUrl) baseUrl.value = current.baseUrl;
    if (current.deviceName) deviceName.value = current.deviceName;
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function startPairing(): Promise<void> {
  if (!extensionSocialBackend) return;
  busy.value = true;
  error.value = null;
  try {
    status.value = await extensionSocialBackend.start(baseUrl.value, deviceName.value);
    toast.success('配对码已生成，请到后端管理页批准');
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function pollPairing(): Promise<void> {
  if (!extensionSocialBackend) return;
  busy.value = true;
  error.value = null;
  try {
    status.value = await extensionSocialBackend.refresh();
    if (status.value.state === 'paired') toast.success('社交发布后端配对成功');
    else if (status.value.state === 'pending') toast.info('管理员尚未批准，请稍后重试');
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function disconnect(): Promise<void> {
  if (!extensionSocialBackend) return;
  busy.value = true;
  error.value = null;
  try {
    status.value = await extensionSocialBackend.disconnect();
    baseUrl.value = '';
    disconnectConfirmation.value = false;
    toast.success('已从插件移除社交发布后端授权');
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function verifyConnection(): Promise<void> {
  if (!socialPublishing) return;
  busy.value = true;
  error.value = null;
  try {
    const destinations = await socialPublishing.listSocialDestinations();
    const publishable = destinations.filter((destination) => destination.canPublish).length;
    toast.success(`连接正常：发现 ${destinations.length} 个目标，其中 ${publishable} 个可发布`);
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}

async function copyPairingCode(): Promise<void> {
  const code = status.value?.pairingCode;
  if (!code) return;
  await globalThis.navigator.clipboard.writeText(code);
  toast.success('配对码已复制');
}
</script>

<template>
  <Card class="p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <Link2 class="size-4 text-primary" />
          <h2 class="font-semibold">社交发布后端</h2>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          配对你自己的 oneVegetable 后端后，插件才能通过 Facebook / Instagram 官方 API 发布。
        </p>
      </div>
      <Badge :variant="status?.state === 'paired' ? 'success' : 'secondary'">{{ stateLabel }}</Badge>
    </div>

    <ErrorNotice v-if="error" class="mt-3" :error="error" fallback="社交发布后端操作失败" compact />

    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <label class="text-sm font-medium sm:col-span-2">
        后端地址
        <Input
          v-model="baseUrl"
          class="mt-2"
          type="url"
          placeholder="https://your-worker.workers.dev"
          :disabled="busy || status?.state === 'paired'"
        />
      </label>
      <label class="text-sm font-medium">
        设备名称
        <Input
          v-model="deviceName"
          class="mt-2"
          maxlength="80"
          :disabled="busy || status?.state === 'paired'"
        />
      </label>
      <div class="text-sm">
        <p class="font-medium">扩展 ID</p>
        <code class="mt-2 block break-all rounded-md bg-muted px-3 py-2 text-xs">
          {{ status?.extensionId }}
        </code>
      </div>
    </div>

    <div v-if="status?.state === 'pending'" class="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p class="text-sm font-medium">在管理页批准此配对码</p>
      <div class="mt-2 flex items-center gap-2">
        <code class="text-lg font-semibold tracking-wider">{{ formattedPairingCode }}</code>
        <Button variant="ghost" size="icon" aria-label="复制配对码" @click="copyPairingCode">
          <Copy class="size-4" />
        </Button>
      </div>
      <p class="mt-2 text-xs text-muted-foreground">
        配对码于 {{ formatDateTime(status.pairingExpiresTimeUtc ?? 0) }} 失效。批准后回到这里检查结果。
      </p>
      <a
        v-if="adminUrl"
        :href="adminUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        打开管理页<ExternalLink class="size-3.5" />
      </a>
    </div>

    <div v-if="status?.state === 'paired' && status.device" class="mt-4 rounded-lg bg-muted/40 p-4 text-sm">
      <p class="font-medium">{{ status.device.name }}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        授权到期：{{ formatDateTime(status.device.expiresTimeUtc) }}；Token 仅保存在受信扩展存储中，不会显示。
      </p>
    </div>

    <div
      v-if="status?.state === 'expired'"
      class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
    >
      <p class="font-medium">设备授权已失效</p>
      <p class="mt-1 text-xs text-muted-foreground">
        可能是 30 天有效期已到或管理员已撤销设备。重新配对会签发新令牌，不会恢复旧令牌。
      </p>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <Button
        v-if="status && status.state !== 'paired' && status.state !== 'pending'"
        :disabled="busy || !baseUrl.trim() || !deviceName.trim()"
        @click="startPairing"
      >
        <Link2 class="size-4" />{{ status.state === 'expired' ? '重新配对' : '开始配对' }}
      </Button>
      <Button v-if="status?.state === 'pending'" :disabled="busy" @click="pollPairing">
        <RefreshCw class="size-4" />检查批准结果
      </Button>
      <Button
        v-if="status?.state === 'paired' && socialPublishing"
        variant="outline"
        :disabled="busy"
        @click="verifyConnection"
      >
        <RefreshCw class="size-4" />检查连接
      </Button>
      <Button
        v-if="status && status.state !== 'unconfigured'"
        variant="outline"
        :disabled="busy"
        @click="disconnectConfirmation = true"
      >
        <Unplug class="size-4" />断开
      </Button>
    </div>
  </Card>

  <ConfirmActionDialog
    :open="disconnectConfirmation"
    title="确认断开社交发布后端"
    description="将从插件删除设备令牌；如需立即让服务端令牌失效，还应在后端管理页撤销该设备。"
    confirm-label="确认断开"
    destructive
    :pending="busy"
    @update:open="disconnectConfirmation = $event"
    @confirm="disconnect"
  />
</template>
