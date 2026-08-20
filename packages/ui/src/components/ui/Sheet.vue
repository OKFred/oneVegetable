<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui';
import { X } from '@lucide/vue';

import Button from './Button.vue';

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string | undefined;
    size?: 'md' | 'lg';
  }>(),
  { description: undefined, size: 'lg' }
);

const emit = defineEmits<{ 'update:open': [open: boolean] }>();
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="ov-dialog-overlay fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px]" />
      <DialogContent
        aria-modal="true"
        class="ov-sheet-content fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-2xl outline-none sm:w-[min(92vw,720px)]"
        :class="size === 'md' ? 'sm:max-w-xl' : 'sm:max-w-[720px]'"
      >
        <header class="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div class="min-w-0">
            <DialogTitle class="truncate text-lg font-semibold">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="mt-1 text-sm text-muted-foreground">
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" size="icon" aria-label="关闭详情">
              <X class="size-4" />
            </Button>
          </DialogClose>
        </header>
        <div v-if="$slots.toolbar" class="shrink-0 border-b px-5 py-3">
          <slot name="toolbar" />
        </div>
        <main class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <slot />
        </main>
        <footer v-if="$slots.footer" class="shrink-0 border-t px-5 py-4">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
