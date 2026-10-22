<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { toast } from 'vue-sonner';
import { WandSparkles } from '@lucide/vue';
import { useServices } from '../lib/services';
import { useAlibabaAuthorizations } from '../lib/alibaba-authorizations';
import { useUnsavedEditingService } from '../lib/unsaved-editing';
import { notifyGatewayConfigurationChanged } from '../lib/gateway-configuration-events';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import AlibabaAuthorizationsPanel from './AlibabaAuthorizationsPanel.vue';
import GatewayCredentialPanel from './GatewayCredentialPanel.vue';
import ErrorNotice from './ErrorNotice.vue';
import CredentialConfigurationDialog from './CredentialConfigurationDialog.vue';
import AlibabaAuthorizationProtocolDialog from './AlibabaAuthorizationProtocolDialog.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import Button from './ui/Button.vue';

const props = defineProps<{ dialogConfiguration?: boolean }>();
const { control } = useServices();
const authorizations = useAlibabaAuthorizations();
const { summary, busy, error, canConfirm } = authorizations;
const t = useGatewayCredentialsI18n();
const editing = useUnsavedEditingService();
const selectedProtocol = ref<'top' | 'iop'>('top');
const ready = ref(false);
const configurationOpen = ref(false);
const configurationBusy = ref(false);
const protocolDialogOpen = ref(false);
const setupGuideOpen = ref(false);
const clearingProtocol = ref<'top' | 'iop' | null>(null);
const clearingRevision = ref<number | null>(null);
const clearing = ref(false);
const credentialPanel = ref<{ reload: () => Promise<void>; canClose: () => boolean } | null>(null);
onMounted(async () => {
  await authorizations.reload();
  if (summary.value) selectedProtocol.value = summary.value.defaultProtocol;
  ready.value = true;
});
async function select(protocol: 'top' | 'iop', showGuide = false): Promise<void> {
  if (configurationBusy.value || clearing.value || (!props.dialogConfiguration && busy.value)) return;
  if (props.dialogConfiguration) {
    selectedProtocol.value = protocol;
    setupGuideOpen.value = showGuide;
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
function beginSetup(protocol: 'top' | 'iop'): void {
  void select(protocol, true);
}
function requestClear(protocol: 'top' | 'iop'): void {
  if (clearing.value || configurationBusy.value) return;
  const profile = summary.value?.[protocol];
  if (!profile?.configured) return;
  // Freeze the version being confirmed; another admin may replace the profile while this dialog is open.
  clearingRevision.value = profile.revision;
  clearingProtocol.value = protocol;
}
async function clearAuthorization(): Promise<void> {
  const protocol = clearingProtocol.value;
  if (!control || !protocol || clearing.value) return;
  const profile = summary.value?.[protocol];
  if (!profile?.configured) return;
  clearing.value = true;
  try {
    await control.clearGatewayCredential(clearingRevision.value, protocol);
    clearingProtocol.value = null;
    await changed();
    notifyGatewayConfigurationChanged();
    toast.success(t('cleared'));
  } catch (cause) {
    clearingProtocol.value = null;
    await authorizations.reload();
    error.value = cause;
  } finally {
    clearing.value = false;
  }
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
      :busy="busy || clearing"
      :configure-busy="dialogConfiguration ? configurationBusy || clearing : undefined"
      :can-confirm="canConfirm"
      :compact="dialogConfiguration"
      :configure-actions="dialogConfiguration"
      :concise-actions="dialogConfiguration"
      :can-clear="dialogConfiguration && !!control"
      @select="select"
      @confirm="confirm"
      @clear="requestClear"
    >
      <template v-if="dialogConfiguration" #actions>
        <Button
          data-testid="open-authorization-guide"
          :disabled="busy || clearing || configurationBusy"
          @click="protocolDialogOpen = true"
          ><WandSparkles class="size-4" />{{ t('quickSetup') }}</Button
        >
      </template>
    </AlibabaAuthorizationsPanel>
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
        :initial-guide="setupGuideOpen"
        :show-clear="false"
        @changed="changed"
        @status-changed="authorizations.reload"
        @busy-changed="configurationBusy = $event"
      >
        <slot :protocol="selectedProtocol" />
      </GatewayCredentialPanel>
    </CredentialConfigurationDialog>
    <AlibabaAuthorizationProtocolDialog v-model:open="protocolDialogOpen" @select="beginSetup" />
    <ConfirmActionDialog
      :open="clearingProtocol !== null"
      :title="t('confirmClear')"
      :description="t('profileClearBody', { protocol: clearingProtocol?.toUpperCase() ?? '' })"
      :pending="clearing"
      destructive
      @update:open="
        (open) => {
          if (!open && !clearing) clearingProtocol = null;
        }
      "
      @confirm="clearAuthorization"
    />
  </div>
</template>
