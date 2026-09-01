<script setup lang="ts">
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import { useUiI18n } from '../i18n';

const { t } = useUiI18n();

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    pending?: boolean;
  }>(),
  {
    description: '',
    confirmLabel: '',
    cancelLabel: '',
    destructive: false,
    pending: false
  }
);

const emit = defineEmits<{
  'update:open': [open: boolean];
  confirm: [];
}>();

function updateOpen(open: boolean): void {
  if (props.pending) return;
  emit('update:open', open);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="title"
    :description="description || undefined"
    size="sm"
    @update:open="updateOpen"
  >
    <div class="space-y-3 text-sm leading-6 text-muted-foreground">
      <slot />
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="pending" @click="updateOpen(false)">{{
          cancelLabel || t('common.actions.cancel')
        }}</Button>
        <Button
          :variant="destructive ? 'destructive' : 'default'"
          :disabled="pending"
          @click="emit('confirm')"
        >
          {{ pending ? t('common.actions.processing') : confirmLabel || t('common.actions.confirm') }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
