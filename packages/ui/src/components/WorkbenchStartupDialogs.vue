<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { toast } from 'vue-sonner';
import type { CredentialVaultRepository } from '@one-vegetable/core';
import { claimLegacyEditorNotice, clearLegacyEditorDrafts } from '../lib/legacy-editor-cleanup';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = defineProps<{ vault?: CredentialVaultRepository; extension: boolean }>();
const emit = defineEmits<{ ready: []; unlocked: []; locked: [] }>();
const { t } = useUiI18n();
const stage = ref<'checking' | 'unlock' | 'cleanup' | 'done'>('checking');
const passphrase = ref('');
const busy = ref(false);
const error = ref('');
let oldKeys: string[] = [];
let alive = true;

onMounted(async () => {
  try {
    if (props.extension && props.vault && (await props.vault.status()).state === 'locked') {
      if (alive) {
        stage.value = 'unlock';
        emit('locked');
      }
      return;
    }
  } catch {
    // Legacy/invalid/unavailable repositories retain their existing Settings repair entry.
  }
  if (alive) next();
});
onBeforeUnmount(() => {
  alive = false;
  passphrase.value = '';
});

function next(): void {
  passphrase.value = '';
  error.value = '';
  try {
    oldKeys = claimLegacyEditorNotice(globalThis.localStorage);
  } catch {
    oldKeys = [];
  }
  if (oldKeys.length) stage.value = 'cleanup';
  else finish();
}
function finish(): void {
  stage.value = 'done';
  emit('ready');
}
async function unlock(): Promise<void> {
  if (!props.vault || busy.value || !passphrase.value) return;
  busy.value = true;
  error.value = '';
  try {
    const status = await props.vault.unlock(passphrase.value);
    if (!alive) return;
    if (status.state !== 'unlocked') {
      error.value = t('shell.startup.unlockFailed');
      return;
    }
    toast.success(t('shell.startup.unlocked'));
    emit('unlocked');
    next();
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
    if ((await props.vault.status()).state === 'unlocked' && alive && unlockVisible()) {
      emit('unlocked');
      next();
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
  if (!open && !busy.value) next();
}
function cleanup(remove: boolean): void {
  if (remove) {
    try {
      clearLegacyEditorDrafts(globalThis.localStorage, oldKeys);
    } catch {
      error.value = t('shell.startup.cleanupFailed');
      return;
    }
  }
  finish();
}
</script>

<template>
  <ModalDialog
    :open="stage === 'unlock'"
    :title="t('shell.startup.unlockTitle')"
    :description="t('shell.startup.unlockDescription')"
    :dismissible="!busy"
    size="sm"
    @update:open="closeUnlock"
  >
    <form id="startup-vault-unlock" @submit.prevent="unlock">
      <label for="startup-vault-passphrase" class="text-sm font-medium">{{
        t('shell.startup.passphrase')
      }}</label>
      <Input
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
        <Button variant="outline" :disabled="busy" @click="next">{{ t('shell.startup.later') }}</Button>
        <Button type="submit" form="startup-vault-unlock" :disabled="busy || !passphrase">{{
          t(busy ? 'shell.startup.unlocking' : 'shell.startup.unlock')
        }}</Button>
      </div>
    </template>
  </ModalDialog>
  <ModalDialog
    :open="stage === 'cleanup'"
    :title="t('shell.startup.cleanupTitle')"
    :description="t('shell.startup.cleanupDescription')"
    size="sm"
    @update:open="
      (open) => {
        if (!open) cleanup(false);
      }
    "
  >
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="cleanup(false)">{{ t('shell.startup.keep') }}</Button>
        <Button @click="cleanup(true)">{{ t('shell.startup.clear') }}</Button>
      </div>
    </template>
  </ModalDialog>
</template>
