<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Camera,
  Copy,
  Link2,
  MessageCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unplug
} from '@lucide/vue';
import { toast } from 'vue-sonner';

import type {
  MetaAppConfigurationSummary,
  ExtensionSocialDevice,
  SocialAccountConnection,
  SocialDestination
} from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';

const { control } = useServices();
const configuration = ref<MetaAppConfigurationSummary | null>(null);
const connections = ref<SocialAccountConnection[]>([]);
const destinations = ref<SocialDestination[]>([]);
const devices = ref<ExtensionSocialDevice[]>([]);
const pairingCode = ref('');
const appId = ref('');
const appSecret = ref('');
const publicOrigin = ref(globalThis.location.origin);
const remark = ref('');
const loading = ref(false);
const error = ref<unknown>(null);
const confirmation = ref<
  | { kind: 'save' }
  | { kind: 'clear' }
  | { kind: 'disconnect'; connection: SocialAccountConnection }
  | { kind: 'approve-pairing' }
  | { kind: 'revoke-device'; device: ExtensionSocialDevice }
  | null
>(null);

const supported = computed(
  () =>
    control !== undefined &&
    'metaAppConfiguration' in control &&
    'updateMetaAppConfiguration' in control &&
    'listMetaConnections' in control
);
const deviceManagementSupported = computed(
  () =>
    control !== undefined &&
    'approveExtensionSocialPairing' in control &&
    'listExtensionSocialDevices' in control &&
    'revokeExtensionSocialDevice' in control
);
const confirmationTitle = computed(() => {
  if (confirmation.value?.kind === 'save') return '确认保存 Meta 应用配置';
  if (confirmation.value?.kind === 'clear') return '确认清除 Meta 应用配置';
  if (confirmation.value?.kind === 'approve-pairing') return '确认批准插件设备';
  if (confirmation.value?.kind === 'revoke-device') return '确认撤销插件设备';
  return '确认断开 Meta 账号';
});
const confirmationDescription = computed(() => {
  const value = confirmation.value;
  if (value?.kind === 'save') {
    return configuration.value?.configured
      ? appSecret.value
        ? '新的 App Secret 会重新加密保存且不再回显。App ID 或公开地址发生变化时，必须先断开现有账号。'
        : '将保留现有 App Secret。App ID 或公开地址发生变化时，必须先断开现有账号。'
      : 'App Secret 会加密保存且不再回显，请确认 App ID 和公开地址正确。';
  }
  if (value?.kind === 'clear') return '只有断开全部 Meta 账号后才能清除应用配置。';
  if (value?.kind === 'approve-pairing') {
    return '批准后，持有此一次性配对码的 Chrome 插件将获得 30 天社交发布设备令牌。';
  }
  if (value?.kind === 'revoke-device') {
    return `撤销 ${value.device.name} 后，该插件无法再读取发布目标或创建社交发布任务。`;
  }
  return value?.kind === 'disconnect'
    ? `断开 ${value.connection.accountName} 后，其 Facebook Page 和 Instagram 发布目标会同时移除。`
    : '';
});

onMounted(async () => {
  showOAuthResult();
  await refresh();
});

async function refresh(): Promise<void> {
  if (!supported.value || !control?.metaAppConfiguration || !control.listMetaConnections) return;
  loading.value = true;
  error.value = null;
  try {
    const [nextConfiguration, nextConnections, nextDestinations, nextDevices] = await Promise.all([
      control.metaAppConfiguration(),
      control.listMetaConnections(),
      control.listSocialDestinations?.() ?? Promise.resolve([]),
      control.listExtensionSocialDevices?.() ?? Promise.resolve([])
    ]);
    configuration.value = nextConfiguration;
    connections.value = nextConnections;
    destinations.value = nextDestinations;
    devices.value = nextDevices;
    publicOrigin.value = nextConfiguration.publicOrigin ?? globalThis.location.origin;
    remark.value = nextConfiguration.remark ?? '';
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    loading.value = false;
  }
}

async function executeConfirmation(): Promise<void> {
  const action = confirmation.value;
  if (!action || !control) return;
  loading.value = true;
  error.value = null;
  try {
    if (action.kind === 'save') {
      if (!control.updateMetaAppConfiguration) throw new Error('当前后端不支持 Meta 应用配置');
      configuration.value = await control.updateMetaAppConfiguration({
        appId: appId.value.trim(),
        appSecret: appSecret.value.trim() || null,
        publicOrigin: publicOrigin.value.trim(),
        revision: configuration.value?.revision ?? null,
        remark: remark.value.trim() || null
      });
      appSecret.value = '';
      toast.success('Meta 应用配置已加密保存');
    } else if (action.kind === 'clear') {
      const revision = configuration.value?.revision;
      if (!control.clearMetaAppConfiguration || revision === null || revision === undefined) {
        throw new Error('当前没有可清除的 Meta 应用配置');
      }
      await control.clearMetaAppConfiguration(revision);
      appId.value = '';
      appSecret.value = '';
      await refresh();
      toast.success('Meta 应用配置已清除');
    } else if (action.kind === 'disconnect') {
      if (!control.disconnectMetaConnection) throw new Error('当前后端不支持断开 Meta 账号');
      await control.disconnectMetaConnection(action.connection.id, action.connection.revision);
      await refresh();
      toast.success(`已断开 ${action.connection.accountName}`);
    } else if (action.kind === 'approve-pairing') {
      if (!control.approveExtensionSocialPairing) throw new Error('当前后端不支持插件配对');
      await control.approveExtensionSocialPairing(pairingCode.value);
      pairingCode.value = '';
      toast.success('插件配对已批准，请回到插件检查结果');
    } else {
      if (!control.revokeExtensionSocialDevice) throw new Error('当前后端不支持撤销插件设备');
      await control.revokeExtensionSocialDevice(action.device.id, action.device.revision);
      await refresh();
      toast.success(`已撤销 ${action.device.name}`);
    }
    confirmation.value = null;
  } catch (cause: unknown) {
    error.value = cause;
  } finally {
    loading.value = false;
  }
}

async function startOAuth(includeInstagram: boolean): Promise<void> {
  if (!control?.startMetaOAuth) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await control.startMetaOAuth(includeInstagram ? ['facebook', 'instagram'] : ['facebook']);
    globalThis.location.assign(result.authorizationUrl);
  } catch (cause: unknown) {
    error.value = cause;
    loading.value = false;
  }
}

async function copyCallback(): Promise<void> {
  const callback = configuration.value?.callbackUrl;
  if (!callback) return;
  await globalThis.navigator.clipboard.writeText(callback);
  toast.success('Callback URL 已复制');
}

function showOAuthResult(): void {
  const query = globalThis.location.hash.split('?')[1];
  if (!query) return;
  const parameters = new URLSearchParams(query);
  const result = parameters.get('meta');
  if (result === 'connected') toast.success('Meta 账号连接成功');
  else if (result === 'failed') toast.error(`Meta 账号连接失败：${parameters.get('reason') ?? '未知原因'}`);
}

function destinationCount(connectionId: string): number {
  return destinations.value.filter((destination) => destination.connectionId === connectionId).length;
}
</script>

<template>
  <Card v-if="supported" class="mt-5 overflow-hidden">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b p-5">
      <div>
        <h2 class="font-semibold">社交账号</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          配置一个 Meta 应用，可连接多个 Facebook 身份及其 Page 和 Instagram 专业账号。
        </p>
      </div>
      <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
        <RefreshCw class="size-4" />刷新
      </Button>
    </div>

    <div class="grid gap-5 p-5 xl:grid-cols-[0.9fr_1.1fr]">
      <section class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="font-medium">Meta 应用配置</h3>
          <Badge :variant="configuration?.configured ? 'success' : 'secondary'">
            {{ configuration?.configured ? `已配置 ···${configuration.appIdSuffix}` : '未配置' }}
          </Badge>
        </div>
        <ErrorNotice v-if="error" :error="error" fallback="Meta 配置操作失败" compact />
        <label class="block space-y-1 text-sm">
          <span>App ID</span>
          <Input v-model="appId" inputmode="numeric" placeholder="Meta App ID" autocomplete="off" />
        </label>
        <label class="block space-y-1 text-sm">
          <span>App Secret</span>
          <Input
            v-model="appSecret"
            type="password"
            :placeholder="configuration?.configured ? '留空则保留现有密钥' : '首次配置时必填'"
            autocomplete="new-password"
          />
        </label>
        <label class="block space-y-1 text-sm">
          <span>公开地址</span>
          <Input v-model="publicOrigin" type="url" placeholder="https://example.com" />
          <span class="block text-xs text-muted-foreground">
            Instagram 需要从该 HTTPS 地址临时读取待发布图片。
          </span>
        </label>
        <label class="block space-y-1 text-sm">
          <span>备注</span>
          <Input v-model="remark" maxlength="500" placeholder="可选" />
        </label>
        <div v-if="configuration?.callbackUrl" class="rounded-lg border bg-muted/30 p-3">
          <p class="text-xs text-muted-foreground">OAuth Callback</p>
          <div class="mt-1 flex items-center gap-2">
            <code class="min-w-0 flex-1 truncate text-xs">{{ configuration.callbackUrl }}</code>
            <Button variant="ghost" size="icon" aria-label="复制 Callback URL" @click="copyCallback">
              <Copy class="size-4" />
            </Button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            :disabled="
              loading ||
              !appId.trim() ||
              (!configuration?.configured && !appSecret.trim()) ||
              !publicOrigin.trim()
            "
            @click="confirmation = { kind: 'save' }"
          >
            <Save class="size-4" />保存配置
          </Button>
          <Button
            variant="outline"
            :disabled="loading || !configuration?.configured"
            @click="startOAuth(false)"
          >
            <Link2 class="size-4" />连接 Facebook Page
          </Button>
          <Button
            variant="outline"
            :disabled="loading || !configuration?.configured"
            @click="startOAuth(true)"
          >
            <Camera class="size-4" />Facebook + Instagram
          </Button>
          <Button
            variant="ghost"
            :disabled="loading || !configuration?.configured"
            @click="confirmation = { kind: 'clear' }"
          >
            <Trash2 class="size-4" />清除配置
          </Button>
        </div>
      </section>

      <section class="space-y-4">
        <div>
          <h3 class="font-medium">已连接账号与发布目标</h3>
          <p class="mt-1 text-xs text-muted-foreground">只有具备创建内容任务和所需授权的目标才可发布。</p>
        </div>
        <p
          v-if="connections.length === 0"
          class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          尚未连接 Meta 账号。
        </p>
        <article v-for="connection in connections" :key="connection.id" class="rounded-lg border p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-medium">{{ connection.accountName }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ destinationCount(connection.id) }} 个目标 · 更新于
                {{ formatDateTime(connection.updateTimeUtc) }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Badge :variant="connection.status === 'connected' ? 'success' : 'warning'">
                {{ connection.status === 'connected' ? '已连接' : '需要重新连接' }}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                :aria-label="`断开 ${connection.accountName}`"
                @click="confirmation = { kind: 'disconnect', connection }"
              >
                <Unplug class="size-4" />
              </Button>
            </div>
          </div>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <div
              v-for="destination in destinations.filter((item) => item.connectionId === connection.id)"
              :key="destination.id"
              class="rounded-md bg-muted/40 p-3 text-sm"
            >
              <div class="flex items-center gap-2">
                <MessageCircle v-if="destination.platform === 'facebook'" class="size-4" />
                <Camera v-else class="size-4" />
                <span class="min-w-0 flex-1 truncate font-medium">{{ destination.name }}</span>
                <Badge :variant="destination.canPublish ? 'success' : 'secondary'">
                  {{ destination.canPublish ? '可发布' : '不可用' }}
                </Badge>
              </div>
              <p v-if="destination.unavailableReasonCode" class="mt-2 text-xs text-muted-foreground">
                {{ destination.unavailableReasonCode }}
              </p>
            </div>
          </div>
        </article>
      </section>
    </div>

    <section v-if="deviceManagementSupported" class="border-t p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <Smartphone class="size-4 text-primary" />
            <h3 class="font-medium">插件设备</h3>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            插件只获得读取目标和社交发布权限，不会取得 Meta App Secret 或平台 Token。
          </p>
        </div>
        <Badge variant="secondary"
          >{{ devices.filter((device) => device.status === 'active').length }} 台有效</Badge
        >
      </div>
      <div class="mt-4 flex flex-wrap items-end gap-2">
        <label class="min-w-64 flex-1 space-y-1 text-sm">
          <span>插件显示的一次性配对码</span>
          <Input
            v-model="pairingCode"
            maxlength="19"
            autocomplete="one-time-code"
            placeholder="ABCD-EFGH-JKLM-NPQR"
          />
        </label>
        <Button
          :disabled="loading || pairingCode.replaceAll('-', '').trim().length !== 16"
          @click="confirmation = { kind: 'approve-pairing' }"
        >
          <ShieldCheck class="size-4" />批准配对
        </Button>
      </div>
      <p
        v-if="devices.length === 0"
        class="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
      >
        暂无已配对插件设备。
      </p>
      <div v-else class="mt-4 grid gap-2 md:grid-cols-2">
        <article v-for="device in devices" :key="device.id" class="rounded-lg border p-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium">{{ device.name }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                到期：{{ formatDateTime(device.expiresTimeUtc) }}
              </p>
              <p v-if="device.lastUsedTimeUtc" class="mt-1 text-xs text-muted-foreground">
                最近使用：{{ formatDateTime(device.lastUsedTimeUtc) }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <Badge :variant="device.status === 'active' ? 'success' : 'secondary'">
                {{ device.status === 'active' ? '有效' : device.status === 'expired' ? '已过期' : '已撤销' }}
              </Badge>
              <Button
                v-if="device.status === 'active'"
                variant="ghost"
                size="icon"
                :aria-label="`撤销 ${device.name}`"
                @click="confirmation = { kind: 'revoke-device', device }"
              >
                <Unplug class="size-4" />
              </Button>
            </div>
          </div>
        </article>
      </div>
    </section>
  </Card>

  <ConfirmActionDialog
    :open="confirmation !== null"
    :title="confirmationTitle"
    :description="confirmationDescription"
    :pending="loading"
    :destructive="
      confirmation?.kind === 'clear' ||
      confirmation?.kind === 'disconnect' ||
      confirmation?.kind === 'revoke-device'
    "
    @update:open="confirmation = $event ? confirmation : null"
    @confirm="executeConfirmation"
  />
</template>
