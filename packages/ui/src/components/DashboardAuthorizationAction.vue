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

const { mode, control, runtime, openCredentialAcquisition } = useServices();
const { t } = useUiI18n();
const credentialText = useGatewayCredentialsI18n();
const open = ref(false);
const loading = ref(false);
const refreshing = ref(false);
const admin = ref(false);
const summary = ref<ControlGatewayCredentialSummary | null>(null);
const error = ref<unknown>(null);
const destination = computed(() =>
  runtime?.backendMeta?.runtime === 'cloudflare' ? '#/admin' : '#/settings'
);

async function begin(): Promise<void> {
  if (mode === 'extension') {
    if (openCredentialAcquisition) openCredentialAcquisition();
    else globalThis.location.hash = '#/settings';
    return;
  }
  if (!control || loading.value || refreshing.value) return;
  error.value = null;
  summary.value = null;
  admin.value = false;
  open.value = true;
  loading.value = true;
  try {
    admin.value = (await control.session()).principal.role === 'admin';
    if (admin.value) summary.value = await control.gatewayCredentialStatus();
  } catch (cause) {
    error.value = cause;
  } finally {
    loading.value = false;
  }
}
async function refresh(): Promise<void> {
  if (!control || !admin.value || !summary.value?.canRefresh || refreshing.value) return;
  refreshing.value = true;
  error.value = null;
  try {
    await control.refreshGatewayCredential();
    open.value = false;
    toast.success(credentialText('refreshed'));
  } catch (cause) {
    error.value = cause;
  } finally {
    refreshing.value = false;
    notifyGatewayConfigurationChanged();
  }
}
</script>

<template>
  <Button v-if="mode !== 'mock'" variant="outline" data-testid="dashboard-renew-authorization" @click="begin">
    <RotateCw class="size-4" />{{ credentialText('renew') }}
  </Button>
  <ModalDialog
    :open="open"
    :dismissible="!refreshing"
    :title="credentialText('renew')"
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
      <p v-else-if="!loading">
        {{
          summary?.lastRefreshErrorCode
            ? credentialText('refreshFailed')
            : summary?.canRefresh
              ? credentialText('refreshAvailable')
              : credentialText('noRefresh')
        }}
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
        <Button v-if="summary?.canRefresh" :disabled="refreshing || loading" @click="refresh">
          <RotateCw class="size-4" />{{
            refreshing ? t('common.actions.processing') : credentialText('refresh')
          }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
