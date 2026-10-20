<script setup lang="ts">
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import ModalDialog from './ui/ModalDialog.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';

defineProps<{
  open: boolean;
  protocol: 'top' | 'iop';
  busy?: boolean;
  inline?: boolean;
}>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const t = useGatewayCredentialsI18n();
</script>

<template>
  <Card v-if="inline" class="p-5"><slot /></Card>
  <ModalDialog
    v-else
    :open="open"
    :title="t('configurationTitle', { protocol: protocol.toUpperCase() })"
    :description="t('configurationDescription', { protocol: protocol.toUpperCase() })"
    size="lg"
    :dismissible="!busy"
    @update:open="emit('update:open', $event)"
  >
    <slot />
    <template #footer>
      <div class="flex justify-end">
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">
          {{ t('closeConfiguration') }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
