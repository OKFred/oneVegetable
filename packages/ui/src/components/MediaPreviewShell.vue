<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ExternalLink, Info, X } from '@lucide/vue';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui';
import Button from './ui/Button.vue';
import Tooltip from './ui/Tooltip.vue';
import { useUiI18n } from '../i18n';

export interface MediaInformation {
  label: string;
  value: string | number | null | undefined;
}
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    originalUrl?: string | null;
    information?: readonly MediaInformation[];
    closeLabel?: string | undefined;
  }>(),
  { description: '', originalUrl: null, information: () => [], closeLabel: undefined }
);
const emit = defineEmits<{
  'update:open': [open: boolean];
  'information-change': [open: boolean];
  keydown: [event: KeyboardEvent];
}>();
const { t } = useUiI18n();
const informationOpen = ref(false);
const original = computed(() => {
  if (!props.originalUrl) return null;
  try {
    const url = new URL(props.originalUrl);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
});
watch(
  () => [props.open, props.originalUrl],
  () => {
    informationOpen.value = false;
  }
);
watch(informationOpen, (open) => {
  emit('information-change', open);
});
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="ov-dialog-overlay fixed inset-0 z-[70] bg-slate-950/95 backdrop-blur-sm" />
      <DialogContent
        class="ov-preview-content fixed inset-0 z-[71] flex flex-col overflow-hidden text-white outline-none"
        aria-modal="true"
        @keydown="emit('keydown', $event)"
      >
        <DialogTitle class="sr-only">{{ title }}</DialogTitle>
        <DialogDescription class="sr-only">{{ description || title }}</DialogDescription>
        <header class="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ title }}</p>
            <p v-if="description" class="mt-0.5 truncate text-xs text-white/60">{{ description }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Tooltip v-if="original" :text="t('photos.previewInfo.original')">
              <a
                :href="original"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex size-9 items-center justify-center rounded-md text-white hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
                :aria-label="t('photos.previewInfo.original')"
                ><ExternalLink class="size-4"
              /></a>
            </Tooltip>
            <Tooltip :text="t('photos.previewInfo.title')">
              <Button
                variant="ghost"
                size="icon"
                class="text-white hover:bg-white/15 hover:text-white"
                :aria-label="t('photos.previewInfo.title')"
                :aria-expanded="informationOpen"
                @click="informationOpen = !informationOpen"
                ><Info class="size-4"
              /></Button>
            </Tooltip>
            <Tooltip :text="closeLabel ?? t('common.actions.close')">
              <DialogClose as-child
                ><Button
                  variant="ghost"
                  size="icon"
                  class="text-white hover:bg-white/15 hover:text-white"
                  :aria-label="closeLabel ?? t('common.actions.close')"
                  ><X class="size-5" /></Button
              ></DialogClose>
            </Tooltip>
          </div>
        </header>
        <div class="relative flex min-h-0 flex-1">
          <div class="flex min-h-0 min-w-0 flex-1 flex-col"><slot /><slot name="footer" /></div>
          <aside
            v-if="informationOpen"
            class="absolute inset-y-0 right-0 z-20 w-[min(90vw,24rem)] overflow-auto border-l bg-background p-4 text-foreground shadow-xl sm:static sm:shrink-0"
            data-testid="media-information"
          >
            <h3 class="mb-4 font-medium">{{ t('photos.previewInfo.title') }}</h3>
            <dl class="space-y-3 text-sm">
              <div
                v-for="(field, index) in information"
                :key="`${field.label}:${index}`"
                class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"
              >
                <dt class="text-muted-foreground">{{ field.label }}</dt>
                <dd class="break-all">{{ field.value ?? '—' }}</dd>
              </div>
            </dl>
            <slot name="information" />
          </aside>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
