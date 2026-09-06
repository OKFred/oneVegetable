<script setup lang="ts">
import { LogIn, ShieldAlert } from '@lucide/vue';

import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';

defineProps<{ open: boolean }>();

const emit = defineEmits<{ reauthenticate: [] }>();
const { t } = useUiI18n();
</script>

<template>
  <ModalDialog
    :open="open"
    :title="t('auth.sessionExpired.title')"
    :description="t('auth.sessionExpired.description')"
    :show-close="false"
    :dismissible="false"
    size="sm"
    data-testid="session-expired-dialog"
  >
    <div class="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <ShieldAlert class="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p class="leading-6 text-muted-foreground">
        {{ t('auth.sessionExpired.safety') }}
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <Button data-testid="session-expired-login" @click="emit('reauthenticate')">
          <LogIn class="size-4" />
          {{ t('auth.sessionExpired.action') }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
