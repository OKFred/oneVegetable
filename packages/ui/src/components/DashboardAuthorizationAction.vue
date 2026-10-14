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

const props = defineProps<{ protocol?: 'top' | 'iop' | undefined }>();
const { mode, control, settings, vault, runtime, openCredentialAcquisition } = useServices();
const { t } = useUiI18n();
const credentialText = useGatewayCredentialsI18n();
const open = ref(false);
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

async function begin(): Promise<void> {
  if (loading.value || refreshing.value) return;
  targetProtocol.value = props.protocol;
  if (mode === 'extension' && !props.protocol) {
    // Keep the original TOP acquisition flow, but never open it for an IOP-only profile.
    if (settings.authorizations) {
      loading.value = true;
      try {
        const status = await vault?.status();
        if (status && !['empty', 'unlocked', 'legacy'].includes(status.state)) {
          globalThis.location.hash = '#/settings';
          return;
        }
        const profiles = await settings.authorizations();
        if (!profiles.top?.configured && profiles.iop?.configured) {
          targetProtocol.value = 'iop';
          summary.value = profiles.iop;
          admin.value = true;
          unlocked.value = true;
          error.value = null;
          open.value = true;
          return;
        }
      } catch (cause) {
        error.value = cause;
        admin.value = true;
        summary.value = null;
        open.value = true;
        return;
      } finally {
        loading.value = false;
      }
    }
    if (openCredentialAcquisition) openCredentialAcquisition();
    else globalThis.location.hash = '#/settings';
    return;
  }
  if (mode === 'bff' && !control) return;
  error.value = null;
  summary.value = null;
  admin.value = false;
  open.value = true;
  loading.value = true;
  try {
    if (mode === 'extension' && props.protocol && settings.authorizations) {
      admin.value = true;
      const status = await vault?.status();
      unlocked.value = !status || status.state === 'unlocked' || status.state === 'legacy';
      if (unlocked.value) summary.value = (await settings.authorizations())[props.protocol];
    } else if (control) {
      admin.value = (await control.session()).principal.role === 'admin';
      if (admin.value) {
        if (!props.protocol && control.gatewayAuthorizations) {
          try {
            const profiles = await control.gatewayAuthorizations();
            targetProtocol.value = profiles.top?.configured
              ? profiles.iop?.configured
                ? profiles.defaultProtocol
                : 'top'
              : profiles.iop?.configured
                ? 'iop'
                : undefined;
          } catch {
            // The optional endpoint may be absent on a legacy server.
          }
        }
        summary.value = targetProtocol.value
          ? await control.gatewayCredentialStatus(targetProtocol.value)
          : await control.gatewayCredentialStatus();
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
    @click="begin"
  >
    <RotateCw class="size-4" />{{ credentialText('renew') }}
  </Button>
  <ModalDialog
    :open="open"
    :dismissible="!refreshing"
    :title="
      targetProtocol
        ? `${targetProtocol.toUpperCase()} · ${credentialText('renew')}`
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
