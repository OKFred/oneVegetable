<script setup lang="ts">
import { computed } from 'vue';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const variants = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      success: 'border-transparent bg-emerald-100 text-emerald-700',
      warning: 'border-transparent bg-amber-100 text-amber-700',
      destructive: 'border-transparent bg-red-100 text-red-700'
    }
  },
  defaultVariants: { variant: 'default' }
});
type BadgeVariants = VariantProps<typeof variants>;
const props = withDefaults(defineProps<{ variant?: BadgeVariants['variant']; class?: string }>(), {
  variant: 'default',
  class: ''
});
const classes = computed(() => cn(variants({ variant: props.variant }), props.class));
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
