<script setup lang="ts">
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';

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
    confirmLabel: '确认',
    cancelLabel: '取消',
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
        <Button variant="outline" :disabled="pending" @click="updateOpen(false)">{{ cancelLabel }}</Button>
        <Button
          :variant="destructive ? 'destructive' : 'default'"
          :disabled="pending"
          @click="emit('confirm')"
        >
          {{ pending ? '正在处理…' : confirmLabel }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
