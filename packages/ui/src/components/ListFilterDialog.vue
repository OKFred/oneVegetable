<script setup lang="ts">
import { Funnel, X } from '@lucide/vue';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  DialogClose
} from 'reka-ui';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import ListActionButton from './ListActionButton.vue';

withDefaults(defineProps<{ open: boolean; activeCount?: number; invalid?: boolean; title?: string }>(), {
  activeCount: 0,
  invalid: false,
  title: ''
});
const emit = defineEmits<{ 'update:open': [open: boolean]; apply: []; reset: [] }>();
const { t } = useUiI18n();
</script>
<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogTrigger as-child
      ><ListActionButton :icon="Funnel"
        >{{ t('common.filters.title') }}<span v-if="activeCount"> · {{ activeCount }}</span></ListActionButton
      ></DialogTrigger
    >
    <DialogPortal>
      <DialogOverlay class="ov-dialog-overlay fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" />
      <DialogContent
        class="ov-dialog-content fixed left-1/2 top-1/2 z-[81] max-h-[90dvh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-6 shadow-xl"
      >
        <DialogTitle class="pr-8 text-lg font-semibold">{{ title || t('common.filters.title') }}</DialogTitle>
        <DialogDescription class="mb-5 mt-1 text-sm text-muted-foreground">{{
          t('common.filters.description')
        }}</DialogDescription>
        <DialogClose as-child
          ><Button
            variant="ghost"
            size="icon"
            class="absolute right-3 top-3"
            :aria-label="t('common.actions.close')"
            ><X class="size-4" /></Button
        ></DialogClose>
        <div class="space-y-4"><slot /></div>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" @click="emit('reset')">{{ t('common.filters.reset') }}</Button>
          <DialogClose as-child
            ><Button variant="outline">{{ t('common.actions.cancel') }}</Button></DialogClose
          >
          <Button :disabled="invalid" @click="emit('apply')">{{ t('common.filters.apply') }}</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
