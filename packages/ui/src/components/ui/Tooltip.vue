<script setup lang="ts">
import { ref } from 'vue';
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger
} from 'reka-ui';

withDefaults(
  defineProps<{
    text: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    delayDuration?: number;
  }>(),
  { side: 'top', delayDuration: 150 }
);

const open = ref(false);
</script>

<template>
  <TooltipProvider :delay-duration="delayDuration" :skip-delay-duration="100">
    <TooltipRoot v-model:open="open">
      <TooltipTrigger as-child>
        <span
          class="inline-flex"
          @mouseenter="open = true"
          @mouseleave="open = false"
          @focusin="open = true"
          @focusout="open = false"
        >
          <slot />
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          class="z-[80] max-w-72 rounded-md border border-border bg-popover px-3 py-2 text-xs leading-5 text-popover-foreground shadow-lg"
          role="tooltip"
          :side="side"
          :side-offset="6"
        >
          {{ text }}
          <TooltipArrow class="fill-popover" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
