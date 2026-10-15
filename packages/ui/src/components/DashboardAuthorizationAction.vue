<script setup lang="ts">
import { computed, ref } from 'vue';
import { RotateCw, Settings } from '@lucide/vue';
import { toast } from 'vue-sonner';
import type { ControlGatewayCredentialSummary } from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { notifyGatewayConfigurationChanged } from '../lib/gateway-configuration-events';
import { useUiI18n } from '../i18n';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import AlibabaAuthorizationProtocolDialog from './AlibabaAuthorizationProtocolDialog.vue';
import { openAlibabaAuthorizationTool } from '../lib/alibaba-authorization-tool';

defineProps<{ protocol?: 'top' | 'iop' | undefined }>();
const { mode, control, settings, vault, runtime, alibabaCredentialAcquisition, openCredentialAcquisition } =
  useServices();
const { t } = useUiI18n();
const credentialText = useGatewayCredentialsI18n();
const open = ref(false);
const protocolOpen = ref(false);
const loading = ref(false);
const refreshing = ref(false);
const admin = ref(false);
const summary = ref<ControlGatewayCredentialSummary | null>(null);
const error = ref<unknown>(null);
const unlocked = ref(true);
const targetProtocol = ref<'top' | 'iop' | undefined>();
const destination = computed(() =>
  runtime?.backendMeta?.runtime === 'cloudflare' ? '#/admin' : '#/settings'
);

function requestBegin(): void {
  if (loading.value || refreshing.value) return;
  protocolOpen.value = true;
}

async function begin(protocol: 'top' | 'iop'): Promise<void> {
  protocolOpen.value = false;
  if (loading.value || refreshing.value) return;
  if (mode === 'bff' && !control) return;
  targetProtocol.value = protocol;
  error.value = null;
  summary.value = null;
  admin.value = false;
  unlocked.value = true;
  // Legacy extensions may not expose profile metadata. Start only the selected tool,
  // directly on the click stack, never a BFF operation or the other protocol's controller.
  if (mode === 'extension' && !settings.authorizations) {
    try {
      const pending = alibabaCredentialAcquisition
        ? openAlibabaAuthorizationTool(alibabaCredentialAcquisition, protocol)
        : undefined;
      if (pending) await pending;
      else if (protocol === 'top' && openCredentialAcquisition) openCredentialAcquisition(protocol);
      else if (protocol === 'top') globalThis.location.hash = '#/settings';
      else {
        admin.value = true;
        error.value = new Error(credentialText('protocolToolUnavailable'));
        open.value = true;
      }
    } catch (cause) {
      admin.value = true;
      error.value = cause;
      open.value = true;
    }
    return;
  }
  open.value = true;
  loading.value = true;
  try {
    if (mode === 'extension' && settings.authorizations) {
      admin.value = true;
      const status = await vault?.status();
      unlocked.value = !status || status.state === 'unlocked' || status.state === 'legacy';
      if (unlocked.value) summary.value = (await settings.authorizations())[protocol];
    } else if (mode === 'bff' && control) {
      admin.value = (await control.session()).principal.role === 'admin';
      if (admin.value) {
        summary.value = await control.gatewayCredentialStatus(protocol);
      }
    }
  } catch (cause) {
    error.value = cause;
  } finally {
    loading.value = false;
  }
}
async function refresh(): Promise<void> {
  if (!admin.value || !summary.value?.canRefresh || refreshing.value) return;
  const protocol = targetProtocol.value;
  if (mode === 'extension' ? !settings.refreshAuthorization || !protocol : !control) return;
  refreshing.value = true;
  error.value = null;
  try {
    if (mode === 'extension' && protocol && settings.refreshAuthorization) {
      summary.value = (await settings.refreshAuthorization(protocol))[protocol];
    } else if (control) {
      if (protocol) await control.refreshGatewayCredential(protocol);
      else await control.refreshGatewayCredential();
    }
    open.value = false;
    toast.success(credentialText('refreshed'));
    notifyGatewayConfigurationChanged();
  } catch (cause) {
    error.value = cause;
    // A failed renewal must preserve the current authorization and never trigger cross-profile retry.
    if (mode === 'extension' && protocol && settings.authorizations) {
      summary.value = await settings
        .authorizations()
        .then((next) => next[protocol])
        .catch(() => summary.value);
    } else if (control) {
      summary.value = await (
        protocol ? control.gatewayCredentialStatus(protocol) : control.gatewayCredentialStatus()
      ).catch(() => summary.value);
    }
  } finally {
    refreshing.value = false;
  }
}
</script>

<template>
  <Button
    v-if="mode !== 'mock'"
    variant="outline"
    :data-testid="protocol ? `dashboard-renew-authorization-${protocol}` : 'dashboard-renew-authorization'"
    @click="requestBegin"
  >
    <RotateCw class="size-4" />{{ credentialText('renew') }}
  </Button>
  <AlibabaAuthorizationProtocolDialog v-model:open="protocolOpen" purpose="renew" @select="begin" />
  <ModalDialog
    :open="open"
    :dismissible="!refreshing"
    :title="
      targetProtocol
        ? credentialText('renewProtocolTitle', { protocol: targetProtocol.toUpperCase() })
        : credentialText('renew')
    "
    :description="credentialText('renewDescription')"
    size="sm"
    @update:open="
      (value) => {
        if (!refreshing) open = value;
      }
    "
  >
    <div class="space-y-3 text-sm">
      <p v-if="loading" role="status">{{ t('common.actions.loading') }}</p>
      <ErrorNotice v-if="error" :error="error" :fallback="credentialText('error')" />
      <p v-if="!loading && !admin">{{ credentialText('adminOnly') }}</p>
      <p v-else-if="!loading && !unlocked">{{ credentialText('unlockForExpiry') }}</p>
      <p v-else-if="!loading">
        {{
          summary?.lastRefreshErrorCode
            ? credentialText('refreshFailed')
            : summary?.canRefresh
              ? credentialText('refreshAvailable')
              : credentialText('noRefresh')
        }}
      </p>
      <p v-if="targetProtocol && !loading" class="text-xs text-muted-foreground">
        {{ credentialText(targetProtocol === 'iop' ? 'renewGuideIop' : 'renewGuide') }}
      </p>
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <a
          v-if="admin && !refreshing"
          :href="destination"
          class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent"
          ><Settings class="size-4" />{{ credentialText('renewSettings') }}</a
        >
        <Button
          v-if="summary?.canRefresh && (mode !== 'extension' || settings.refreshAuthorization)"
          variant="outline"
          :disabled="refreshing || loading"
          @click="refresh"
        >
          <RotateCw class="size-4" />{{
            refreshing ? t('common.actions.processing') : credentialText('refresh')
          }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
