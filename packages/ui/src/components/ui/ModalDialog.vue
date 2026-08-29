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
    size?: 'sm' | 'md' | 'lg';
  }>(),
  { description: undefined, size: 'md' }
);

const emit = defineEmits<{ 'update:open': [open: boolean] }>();
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        class="ov-dialog-overlay fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-sm"
        @click="emit('update:open', false)"
      />
      <DialogContent
        class="ov-dialog-content fixed left-1/2 top-1/2 z-[61] flex max-h-[min(88vh,760px)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-2xl outline-none"
        :class="size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl'"
      >
        <header class="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="mt-1 text-sm leading-5 text-muted-foreground">
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" size="icon" :aria-label="`关闭${title}`">
              <X class="size-4" />
            </Button>
          </DialogClose>
        </header>
        <main class="min-h-0 flex-1 overflow-y-auto p-5">
          <slot />
        </main>
        <footer v-if="$slots.footer" class="shrink-0 border-t px-5 py-4">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
