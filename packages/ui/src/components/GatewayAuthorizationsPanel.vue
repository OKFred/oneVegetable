<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { toast } from 'vue-sonner';
import { useAlibabaAuthorizations } from '../lib/alibaba-authorizations';
import { useUnsavedEditingService } from '../lib/unsaved-editing';
import { notifyGatewayConfigurationChanged } from '../lib/gateway-configuration-events';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import AlibabaAuthorizationsPanel from './AlibabaAuthorizationsPanel.vue';
import GatewayCredentialPanel from './GatewayCredentialPanel.vue';
import ErrorNotice from './ErrorNotice.vue';
import CredentialConfigurationDialog from './CredentialConfigurationDialog.vue';

const props = defineProps<{ dialogConfiguration?: boolean }>();
const authorizations = useAlibabaAuthorizations();
const { summary, busy, error, canConfirm } = authorizations;
const t = useGatewayCredentialsI18n();
const editing = useUnsavedEditingService();
const selectedProtocol = ref<'top' | 'iop'>('top');
const ready = ref(false);
const configurationOpen = ref(false);
const configurationBusy = ref(false);
const credentialPanel = ref<{ reload: () => Promise<void>; canClose: () => boolean } | null>(null);
onMounted(async () => {
  await authorizations.reload();
  if (summary.value) selectedProtocol.value = summary.value.defaultProtocol;
  ready.value = true;
});
async function select(protocol: 'top' | 'iop'): Promise<void> {
  if (configurationBusy.value || (!props.dialogConfiguration && busy.value)) return;
  if (props.dialogConfiguration) {
    selectedProtocol.value = protocol;
    configurationOpen.value = true;
    return;
  }
  if (protocol === selectedProtocol.value) {
    toast.info(t('profileAlreadySelected', { protocol: protocol.toUpperCase() }));
    return;
  }
  if (editing && !(await editing.confirmLeave())) return;
  selectedProtocol.value = protocol;
  toast.info(t('profileSelected', { protocol: protocol.toUpperCase() }));
}
async function changed(): Promise<void> {
  authorizations.invalidateBinding();
  await authorizations.reload();
}
function closeConfiguration(open: boolean): void {
  if (open || configurationBusy.value || credentialPanel.value?.canClose() === false) return;
  configurationOpen.value = false;
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
      :configure-busy="dialogConfiguration ? configurationBusy : undefined"
      :can-confirm="canConfirm"
      :compact="dialogConfiguration"
      :configure-actions="dialogConfiguration"
      @select="select"
      @confirm="confirm"
    />
    <ErrorNotice v-if="error" :error="error" :fallback="t('error')" />
    <GatewayCredentialPanel
      v-if="ready && (!summary || !dialogConfiguration)"
      :key="summary ? selectedProtocol : 'legacy'"
      ref="credentialPanel"
      :protocol="summary ? selectedProtocol : undefined"
      @changed="changed"
      @status-changed="authorizations.reload"
    >
      <slot :protocol="summary ? selectedProtocol : undefined" />
    </GatewayCredentialPanel>
    <CredentialConfigurationDialog
      v-if="summary && dialogConfiguration"
      :open="configurationOpen"
      :protocol="selectedProtocol"
      :busy="configurationBusy"
      @update:open="closeConfiguration"
    >
      <GatewayCredentialPanel
        v-if="configurationOpen"
        :key="selectedProtocol"
        ref="credentialPanel"
        :protocol="selectedProtocol"
        embedded
        @changed="changed"
        @status-changed="authorizations.reload"
        @busy-changed="configurationBusy = $event"
      >
        <slot :protocol="selectedProtocol" />
      </GatewayCredentialPanel>
    </CredentialConfigurationDialog>
  </div>
</template>
