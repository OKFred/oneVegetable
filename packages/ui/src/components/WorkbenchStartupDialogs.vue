<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { toast } from 'vue-sonner';
import type { CredentialVaultRepository } from '@one-vegetable/core';
import { useUiI18n } from '../i18n';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = defineProps<{ vault?: CredentialVaultRepository; extension: boolean }>();
const emit = defineEmits<{ ready: []; unlocked: []; locked: [] }>();
const { t } = useUiI18n();
const credentialText = useGatewayCredentialsI18n();
const stage = ref<'checking' | 'unlock' | 'done'>('checking');
const passphrase = ref('');
const deviceProtected = ref(false);
const busy = ref(false);
const error = ref('');
let alive = true;

onMounted(async () => {
  try {
    const status = props.extension && props.vault ? await props.vault.status() : null;
    if (status?.state === 'locked') {
      if (alive) {
        deviceProtected.value = status.deviceProtected === true;
        stage.value = 'unlock';
        emit('locked');
      }
      return;
    }
  } catch {
    // Legacy/invalid/unavailable repositories retain their existing Settings repair entry.
  }
  if (alive) finish();
});
onBeforeUnmount(() => {
  alive = false;
  passphrase.value = '';
});

function finish(): void {
  passphrase.value = '';
  error.value = '';
  stage.value = 'done';
  emit('ready');
}
async function unlock(): Promise<void> {
  if (!props.vault || busy.value || (!deviceProtected.value && !passphrase.value)) return;
  busy.value = true;
  error.value = '';
  try {
    const status = await props.vault.unlock(deviceProtected.value ? '' : passphrase.value);
    if (!alive) return;
    if (status.state !== 'unlocked') {
      error.value = t('shell.startup.unlockFailed');
      return;
    }
    toast.success(t('shell.startup.unlocked'));
    emit('unlocked');
    finish();
  } catch {
    if (alive) error.value = t('shell.startup.unlockFailed');
  } finally {
    busy.value = false;
    passphrase.value = '';
  }
}
async function recheckSession(): Promise<void> {
  if (stage.value !== 'unlock' || busy.value || !props.vault) return;
  try {
    const status = await props.vault.status();
    if (alive && status.state === 'locked') deviceProtected.value = status.deviceProtected === true;
    if (status.state === 'unlocked' && alive && unlockVisible()) {
      emit('unlocked');
      finish();
    }
  } catch {
    /* Settings remains available; focus checks never open another prompt. */
  }
}
function unlockVisible(): boolean {
  return stage.value === 'unlock';
}
function handleFocus(): void {
  void recheckSession();
}
onMounted(() => {
  globalThis.addEventListener('focus', handleFocus);
});
onBeforeUnmount(() => {
  globalThis.removeEventListener('focus', handleFocus);
});
function closeUnlock(open: boolean): void {
  if (!open && !busy.value) finish();
}
</script>

<template>
  <ModalDialog
    :open="stage === 'unlock'"
    :title="t('shell.startup.unlockTitle')"
    :description="
      deviceProtected ? credentialText('protectionDeviceHelp') : t('shell.startup.unlockDescription')
    "
    :dismissible="!busy"
    size="sm"
    @update:open="closeUnlock"
  >
    <form id="startup-vault-unlock" @submit.prevent="unlock">
      <label v-if="!deviceProtected" for="startup-vault-passphrase" class="text-sm font-medium">{{
        t('shell.startup.passphrase')
      }}</label>
      <Input
        v-if="!deviceProtected"
        id="startup-vault-passphrase"
        v-model="passphrase"
        type="password"
        autocomplete="current-password"
        :disabled="busy"
        data-feedback-redact
        class="mt-2"
      />
      <p v-if="error" class="mt-2 text-sm text-destructive" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="busy" @click="finish">{{ t('shell.startup.later') }}</Button>
        <Button
          type="submit"
          form="startup-vault-unlock"
          :disabled="busy || (!deviceProtected && !passphrase)"
          >{{ t(busy ? 'shell.startup.unlocking' : 'shell.startup.unlock') }}</Button
        >
      </div>
    </template>
  </ModalDialog>
</template>
