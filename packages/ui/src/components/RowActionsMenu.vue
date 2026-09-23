<script setup lang="ts">
import { ref } from 'vue';
import { Ellipsis } from '@lucide/vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import RowActionItems from './RowActionItems.vue';
defineProps<{ label?: string }>();
const { t } = useUiI18n();
const open = ref(false);
function activate(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('button:not(:disabled),a[href]'))
    open.value = false;
}
function navigate(event: KeyboardEvent): void {
  if (
    !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
    !(event.currentTarget instanceof HTMLElement)
  )
    return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')
  ].filter((button) => !button.hidden && !button.classList.contains('hidden'));
  const index = buttons.findIndex((button) => button === globalThis.document.activeElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  if (buttons[next]) {
    event.preventDefault();
    buttons[next].focus();
  }
}
</script>
<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child
      ><Button size="icon" variant="ghost" class="size-8" :aria-label="label || t('common.actions.title')"
        ><Ellipsis class="size-4" /></Button
    ></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        align="end"
        :side-offset="4"
        class="z-[90] min-w-40 max-w-[min(24rem,calc(100vw-2rem))] rounded-md border bg-popover p-1.5 text-popover-foreground shadow-lg"
        @click="activate"
        @keydown="navigate"
      >
        <RowActionItems><slot /></RowActionItems>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
<style scoped>
.row-actions :deep(div) {
  flex-direction: column;
  align-items: stretch;
}
.row-actions :deep(button),
.row-actions :deep(a) {
  width: 100%;
  justify-content: flex-start;
}
.row-actions :deep(a) {
  display: inline-flex;
  height: 2rem;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border: 0;
  border-radius: 0.125rem;
  background: transparent;
  color: hsl(var(--popover-foreground));
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  box-shadow: none;
}
.row-actions :deep(a:hover) {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}
</style>
