<script setup lang="ts">
import { computed, inject, ref } from 'vue';

import { cn } from '../../lib/utils';
import { rowActionButtonContext } from '../../lib/button-context';
import { buttonVariants, type ButtonVariants } from './button-styles';
const props = withDefaults(
  defineProps<{
    variant?: ButtonVariants['variant'];
    size?: ButtonVariants['size'];
    class?: string;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'default', size: 'default', class: '', type: 'button' }
);
const inRowActions = inject(rowActionButtonContext, false);
const classes = computed(() =>
  cn(
    buttonVariants({ variant: inRowActions ? 'ghost' : props.variant, size: props.size }),
    props.class,
    inRowActions &&
      'h-8 w-full justify-start rounded-sm border-0 bg-transparent px-2 py-1 text-sm shadow-none',
    inRowActions &&
      (props.variant === 'destructive'
        ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
        : 'text-popover-foreground hover:bg-accent hover:text-accent-foreground')
  )
);
const element = ref<HTMLButtonElement | null>(null);

function focus(): void {
  element.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <button ref="element" :type="type" :class="classes"><slot /></button>
</template>
