<script setup lang="ts">
import Tooltip from './ui/Tooltip.vue';

withDefaults(
  defineProps<{
    disabled: boolean;
    reason?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    wrapperClass?: string;
  }>(),
  { reason: '', side: 'top', wrapperClass: '' }
);
</script>

<template>
  <Tooltip v-if="disabled && reason" :text="reason" :side="side">
    <span
      tabindex="0"
      :class="[
        'inline-flex outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring',
        wrapperClass
      ]"
      :aria-label="reason"
    >
      <slot />
    </span>
  </Tooltip>
  <span v-else :class="['inline-flex', wrapperClass]">
    <slot />
  </span>
</template>
