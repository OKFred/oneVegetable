<script setup lang="ts">
import { LayoutGrid, List } from '@lucide/vue';
import Button from './ui/Button.vue';

defineProps<{ modelValue: 'cards' | 'list'; label: string; cardsLabel: string; listLabel: string }>();
defineEmits<{ 'update:modelValue': [value: 'cards' | 'list'] }>();
</script>

<template>
  <div
    data-list-view-toggle
    class="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-md border bg-background p-0.5"
    role="group"
    :aria-label="label"
  >
    <Button
      :variant="modelValue === 'cards' ? 'secondary' : 'ghost'"
      class="h-7 gap-2 px-3"
      :aria-pressed="modelValue === 'cards'"
      @click="$emit('update:modelValue', 'cards')"
    >
      <LayoutGrid class="size-4 shrink-0" aria-hidden="true" />{{ cardsLabel }}
    </Button>
    <Button
      :variant="modelValue === 'list' ? 'secondary' : 'ghost'"
      class="h-7 gap-2 px-3"
      :aria-pressed="modelValue === 'list'"
      @click="$emit('update:modelValue', 'list')"
    >
      <List class="size-4 shrink-0" aria-hidden="true" />{{ listLabel }}
    </Button>
  </div>
</template>
