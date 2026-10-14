<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useAlibabaAuthorizations } from '../lib/alibaba-authorizations';
import { useUnsavedEditingService } from '../lib/unsaved-editing';
import { notifyGatewayConfigurationChanged } from '../lib/gateway-configuration-events';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import AlibabaAuthorizationsPanel from './AlibabaAuthorizationsPanel.vue';
import GatewayCredentialPanel from './GatewayCredentialPanel.vue';
import ErrorNotice from './ErrorNotice.vue';

const authorizations = useAlibabaAuthorizations();
const { summary, busy, error, canConfirm } = authorizations;
const t = useGatewayCredentialsI18n();
const editing = useUnsavedEditingService();
const selectedProtocol = ref<'top' | 'iop'>('top');
const ready = ref(false);
const credentialPanel = ref<{ reload: () => Promise<void> } | null>(null);
onMounted(async () => {
  await authorizations.reload();
  if (summary.value) selectedProtocol.value = summary.value.defaultProtocol;
  ready.value = true;
});
async function select(protocol: 'top' | 'iop'): Promise<void> {
  if (busy.value || protocol === selectedProtocol.value) return;
  if (editing && !(await editing.confirmLeave())) return;
  selectedProtocol.value = protocol;
}
async function changed(): Promise<void> {
  authorizations.invalidateBinding();
  await authorizations.reload();
}
async function confirm(): Promise<void> {
  await authorizations.confirm();
  if (!error.value) notifyGatewayConfigurationChanged();
}
async function reload(): Promise<void> {
  await authorizations.reload();
  await credentialPanel.value?.reload();
}
defineExpose({ reload });
</script>

<template>
  <div class="space-y-4">
    <AlibabaAuthorizationsPanel
      v-if="summary"
      :summary="summary"
      :selected-protocol="selectedProtocol"
      :busy="busy"
      :can-confirm="canConfirm"
      @select="select"
      @confirm="confirm"
    />
    <ErrorNotice v-if="error" :error="error" :fallback="t('error')" />
    <GatewayCredentialPanel
      v-if="ready"
      :key="summary ? selectedProtocol : 'legacy'"
      ref="credentialPanel"
      :protocol="summary ? selectedProtocol : undefined"
      @changed="changed"
      @status-changed="authorizations.reload"
    >
      <slot :protocol="summary ? selectedProtocol : undefined" />
    </GatewayCredentialPanel>
  </div>
</template>
