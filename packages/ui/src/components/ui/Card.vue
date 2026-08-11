<script setup lang="ts">
import { cn } from '../../lib/utils';

withDefaults(defineProps<{ class?: string }>(), { class: '' });
</script>

<template>
  <section :class="cn('rounded-xl border bg-card text-card-foreground shadow-sm', $props.class)">
    <slot />
  </section>
</template>
