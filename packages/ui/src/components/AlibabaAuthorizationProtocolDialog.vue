<script setup lang="ts">
import { ArrowRight, Sparkles } from '@lucide/vue';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';

withDefaults(defineProps<{ open: boolean; purpose?: 'acquire' | 'renew' }>(), { purpose: 'acquire' });
const emit = defineEmits<{
  'update:open': [open: boolean];
  select: [protocol: 'top' | 'iop'];
}>();
const text = useGatewayCredentialsI18n();
const { t } = useUiI18n();

function select(protocol: 'top' | 'iop'): void {
  // Keep the selection handler on the click stack for Chrome's optional-permission prompt.
  emit('select', protocol);
  emit('update:open', false);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="text(purpose === 'renew' ? 'chooseRenewProtocol' : 'chooseAcquireProtocol')"
    :description="text('chooseProtocolDescription')"
    size="sm"
    @update:open="emit('update:open', $event)"
  >
    <div class="grid gap-3" data-testid="alibaba-authorization-protocol-choices">
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
        <Button
          variant="outline"
          data-testid="cancel-authorization-protocol"
          @click="emit('update:open', false)"
        >
          {{ t('common.actions.cancel') }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
