<script setup lang="ts">
import { computed, ref } from 'vue';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out hover:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);

type ButtonVariants = VariantProps<typeof buttonVariants>;
const props = withDefaults(
  defineProps<{
    variant?: ButtonVariants['variant'];
    size?: ButtonVariants['size'];
    class?: string;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'default', size: 'default', class: '', type: 'button' }
);
const classes = computed(() => cn(buttonVariants({ variant: props.variant, size: props.size }), props.class));
const element = ref<HTMLButtonElement | null>(null);

function focus(): void {
  element.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <button ref="element" :type="type" :class="classes"><slot /></button>
</template>
