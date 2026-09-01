<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut
} from '@lucide/vue';
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
import { useUiI18n } from '../i18n';

export interface ImagePreviewItem {
  id: string;
  src: string;
  alt: string;
  description?: string | undefined;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    images: readonly ImagePreviewItem[];
    initialIndex?: number;
  }>(),
  { initialIndex: 0 }
);
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const { t } = useUiI18n();

const index = ref(0);
const scale = ref(1);
const rotation = ref(0);
const current = computed(() => props.images[index.value]);
const percentage = computed(() => Math.round(scale.value * 100));
const imageStyle = computed(() => ({
  transform: `scale(${scale.value}) rotate(${rotation.value}deg)`
}));

watch(
  () => [props.open, props.initialIndex, props.images.length] as const,
  ([open, initialIndex, length]) => {
    if (!open) return;
    index.value = Math.min(Math.max(initialIndex, 0), Math.max(length - 1, 0));
    resetTransform();
  },
  { immediate: true }
);

function resetTransform(): void {
  scale.value = 1;
  rotation.value = 0;
}

function move(offset: number): void {
  if (props.images.length < 2) return;
  index.value = (index.value + offset + props.images.length) % props.images.length;
  resetTransform();
}

function zoom(offset: number): void {
  scale.value = Math.min(4, Math.max(0.25, Number((scale.value + offset).toFixed(2))));
}

function rotate(offset: number): void {
  rotation.value = (rotation.value + offset) % 360;
}

function handleWheel(event: WheelEvent): void {
  zoom(event.deltaY < 0 ? 0.25 : -0.25);
}

function toggleZoom(): void {
  scale.value = scale.value === 1 ? 2 : 1;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') move(-1);
  else if (event.key === 'ArrowRight') move(1);
  else if (event.key === '+' || event.key === '=') zoom(0.25);
  else if (event.key === '-') zoom(-0.25);
  else return;
  event.preventDefault();
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="ov-dialog-overlay fixed inset-0 z-[70] bg-slate-950/90 backdrop-blur-sm" />
      <DialogContent
        class="ov-preview-content fixed inset-0 z-[71] flex flex-col overflow-hidden text-white outline-none"
        aria-modal="true"
        @keydown="handleKeydown"
      >
        <DialogTitle class="sr-only">{{ t('common.imagePreview.title') }}</DialogTitle>
        <DialogDescription class="sr-only">{{ t('common.imagePreview.description') }}</DialogDescription>

        <header class="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ current?.alt ?? t('common.imagePreview.title') }}
            </p>
            <p class="mt-0.5 text-xs text-white/60">
              {{ images.length ? `${index + 1} / ${images.length}` : t('common.imagePreview.empty') }}
              <template v-if="current?.description"> · {{ current.description }}</template>
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <a
              v-if="current"
              class="inline-flex size-9 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              :aria-label="t('common.imagePreview.openOriginal')"
              :href="current.src"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink class="size-4" />
            </a>
            <DialogClose as-child>
              <Button
                variant="ghost"
                size="icon"
                class="text-white hover:bg-white/15 hover:text-white"
                :aria-label="t('common.imagePreview.close')"
              >
                <X class="size-5" />
              </Button>
            </DialogClose>
          </div>
        </header>

        <div
          class="relative min-h-0 flex-1 overflow-hidden px-12 py-4 sm:px-20"
          data-testid="image-preview-stage"
          @wheel.prevent="handleWheel"
        >
          <button
            v-if="images.length > 1"
            type="button"
            class="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-3 text-white shadow-lg backdrop-blur hover:bg-black/60 sm:left-5"
            :aria-label="t('common.imagePreview.previous')"
            @click="move(-1)"
          >
            <ChevronLeft class="size-6" />
          </button>
          <div class="flex size-full items-center justify-center overflow-auto">
            <img
              v-if="current"
              :key="current.id"
              :src="current.src"
              :alt="current.alt"
              class="max-h-full max-w-full select-none object-contain transition-transform duration-200 ease-out"
              :style="imageStyle"
              draggable="false"
              @dblclick="toggleZoom"
            />
            <p v-else class="text-sm text-white/60">{{ t('common.imagePreview.noPreview') }}</p>
          </div>
          <button
            v-if="images.length > 1"
            type="button"
            class="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-3 text-white shadow-lg backdrop-blur hover:bg-black/60 sm:right-5"
            :aria-label="t('common.imagePreview.next')"
            @click="move(1)"
          >
            <ChevronRight class="size-6" />
          </button>
        </div>

        <footer class="flex shrink-0 items-center justify-center gap-1 px-4 py-4">
          <div class="flex items-center gap-1 rounded-full bg-black/45 p-1.5 shadow-lg backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:bg-white/15 hover:text-white"
              :disabled="scale <= 0.25"
              :aria-label="t('common.imagePreview.zoomOut')"
              @click="zoom(-0.25)"
            >
              <ZoomOut class="size-4" />
            </Button>
            <span class="w-12 text-center text-xs tabular-nums">{{ percentage }}%</span>
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:bg-white/15 hover:text-white"
              :disabled="scale >= 4"
              :aria-label="t('common.imagePreview.zoomIn')"
              @click="zoom(0.25)"
            >
              <ZoomIn class="size-4" />
            </Button>
            <span class="mx-1 h-5 w-px bg-white/20" />
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:bg-white/15 hover:text-white"
              :aria-label="t('common.imagePreview.rotateLeft')"
              @click="rotate(-90)"
            >
              <RotateCcw class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:bg-white/15 hover:text-white"
              :aria-label="t('common.imagePreview.rotateRight')"
              @click="rotate(90)"
            >
              <RotateCw class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:bg-white/15 hover:text-white"
              :aria-label="t('common.imagePreview.reset')"
              @click="resetTransform"
            >
              <RefreshCw class="size-4" />
            </Button>
          </div>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
