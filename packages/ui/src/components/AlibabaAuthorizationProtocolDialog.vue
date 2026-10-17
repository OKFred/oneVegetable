<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowRight, Sparkles } from '@lucide/vue';
import { toast } from 'vue-sonner';
import {
  validateVaultPassphrase,
  type CredentialVaultRepository,
  type CredentialVaultStatus
} from '@one-vegetable/core';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    purpose?: 'acquire' | 'renew';
    vault?: CredentialVaultRepository | undefined;
  }>(),
  { purpose: 'acquire', vault: undefined }
);
const emit = defineEmits<{
  'update:open': [open: boolean];
  select: [protocol: 'top' | 'iop'];
  prepared: [status: CredentialVaultStatus];
}>();
const text = useGatewayCredentialsI18n();
const { t } = useUiI18n();
const phase = ref<'checking' | 'protection' | 'choices' | 'error'>('checking');
const status = ref<CredentialVaultStatus | null>(null);
const passphrase = ref('');
const busy = ref(false);
let generation = 0;
const needsPassphrase = computed(() => status.value?.state === 'locked' && !status.value.deviceProtected);
const showPassphrase = computed(() => !status.value?.deviceProtected || status.value.state !== 'locked');

function reset(): void {
  generation++;
  passphrase.value = '';
  status.value = null;
  busy.value = false;
  phase.value = 'checking';
}

async function initialize(): Promise<void> {
  reset();
  if (!props.vault?.prepareAuthorization) {
    phase.value = 'choices';
    return;
  }
  const current = generation;
  try {
    const next = await props.vault.status();
    if (current !== generation || !props.open) return;
    status.value = next;
    if (next.state === 'invalid') throw new Error('INVALID_VAULT');
    phase.value = next.state === 'unlocked' ? 'choices' : 'protection';
    if (next.state === 'unlocked') emit('prepared', next);
  } catch {
    if (current !== generation || !props.open) return;
    phase.value = 'error';
    toast.error(text('protectionFailed'));
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void initialize();
    else reset();
  },
  { immediate: true }
);
onBeforeUnmount(reset);

async function prepare(): Promise<void> {
  const vault = props.vault;
  if (!vault?.prepareAuthorization || busy.value || phase.value !== 'protection') return;
  if (needsPassphrase.value && !passphrase.value) return;
  const current = generation;
  busy.value = true;
  try {
    const locked = status.value?.state === 'locked';
    if (!locked && passphrase.value) validateVaultPassphrase(passphrase.value);
    const next = locked
      ? await vault.unlock(status.value?.deviceProtected ? '' : passphrase.value)
      : await vault.prepareAuthorization(passphrase.value);
    if (current !== generation || !props.open) return;
    if (next.state !== 'unlocked') throw new Error('VAULT_NOT_UNLOCKED');
    status.value = next;
    phase.value = 'choices';
    emit('prepared', next);
  } catch {
    if (current === generation && props.open) toast.error(text('protectionFailed'));
  } finally {
    if (current === generation) {
      passphrase.value = '';
      busy.value = false;
    }
  }
}

function close(open: boolean): void {
  if (!open) reset();
  emit('update:open', open);
}

function select(protocol: 'top' | 'iop'): void {
  if (phase.value !== 'choices') return;
  // Keep the selection handler on the click stack for Chrome's optional-permission prompt.
  emit('select', protocol);
  close(false);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="text(purpose === 'renew' ? 'chooseRenewProtocol' : 'chooseAcquireProtocol')"
    :description="text(phase === 'choices' ? 'chooseProtocolDescription' : 'protectionDescription')"
    size="sm"
    @update:open="close"
  >
    <p v-if="phase === 'checking'" role="status">{{ t('common.actions.loading') }}</p>
    <p v-else-if="phase === 'error'" role="alert">{{ text('protectionFailed') }}</p>
    <form
      v-else-if="phase === 'protection'"
      class="grid gap-3"
      data-testid="authorization-protection"
      @submit.prevent="prepare"
    >
      <label v-if="showPassphrase" class="text-sm font-medium">
        {{ text(needsPassphrase ? 'protectionOriginal' : 'protectionOptional') }}
        <Input
          v-model="passphrase"
          class="mt-2"
          type="password"
          :autocomplete="needsPassphrase ? 'current-password' : 'new-password'"
          :required="needsPassphrase"
          :disabled="busy"
          :aria-label="text(needsPassphrase ? 'protectionOriginal' : 'protectionOptional')"
          :placeholder="needsPassphrase ? '' : text('protectionPlaceholder')"
          data-testid="authorization-protection-passphrase"
          data-feedback-redact
        />
      </label>
      <p class="text-xs leading-5 text-muted-foreground">
        {{ text(needsPassphrase ? 'protectionOriginalHelp' : 'protectionDeviceHelp') }}
      </p>
      <Button
        type="submit"
        :disabled="busy || (needsPassphrase && !passphrase)"
        data-testid="continue-authorization-protection"
      >
        {{ busy ? t('common.actions.processing') : text('protectionContinue') }}
      </Button>
    </form>
    <div v-else class="grid gap-3" data-testid="alibaba-authorization-protocol-choices">
      <Button
        class="h-auto justify-between gap-3 whitespace-normal p-4 text-left"
        variant="outline"
        data-testid="choose-authorization-iop"
        @click="select('iop')"
      >
        <span class="min-w-0">
          <span class="flex items-center gap-2 font-medium">
            <Sparkles class="size-4 shrink-0" aria-hidden="true" />{{ text('chooseProtocolIop') }}
          </span>
          <span class="mt-1 block text-xs leading-5 text-muted-foreground">{{
            text('chooseProtocolIopHelp')
          }}</span>
        </span>
        <ArrowRight class="size-4 shrink-0" aria-hidden="true" />
      </Button>
      <Button
        class="h-auto justify-between gap-3 whitespace-normal p-4 text-left"
        variant="outline"
        data-testid="choose-authorization-top"
        @click="select('top')"
      >
        <span class="min-w-0">
          <span class="block font-medium">{{ text('chooseProtocolTop') }}</span>
          <span class="mt-1 block text-xs leading-5 text-muted-foreground">{{
            text('chooseProtocolTopHelp')
          }}</span>
        </span>
        <ArrowRight class="size-4 shrink-0" aria-hidden="true" />
      </Button>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <Button variant="outline" data-testid="cancel-authorization-protocol" @click="close(false)">
          {{ t('common.actions.cancel') }}
        </Button>
        <Button v-if="phase === 'error'" variant="outline" @click="initialize">{{
          t('common.actions.retry')
        }}</Button>
      </div>
    </template>
  </ModalDialog>
</template>
