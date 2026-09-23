<script setup lang="ts">
import { ref, type Component } from 'vue';
import Button from './ui/Button.vue';
import { cn } from '../lib/utils';

withDefaults(
  defineProps<{
    icon: Component;
    iconClass?: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  {
    type: 'button',
    iconClass: '',
    disabled: false
  }
);
const button = ref<{ focus: () => void } | null>(null);
function focus(): void {
  button.value?.focus();
}
defineExpose({ focus });
</script>

<template>
  <Button ref="button" data-list-action :type="type" :disabled="disabled" variant="outline" class="shrink-0">
    <component :is="icon" :class="cn('size-4 shrink-0', iconClass)" aria-hidden="true" focusable="false" />
    <slot />
  </Button>
</template>
