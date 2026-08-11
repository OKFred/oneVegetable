<script setup lang="ts">
import { computed } from 'vue';

import { cn } from '../../lib/utils';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    class?: string;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
  }>(),
  { modelValue: '', class: '', type: 'text', placeholder: '', disabled: false }
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const value = computed({
  get: () => props.modelValue,
  set: (next: string) => {
    emit('update:modelValue', next);
  }
});
</script>

<template>
  <input
    v-model="value"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="
      cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        $props.class
      )
    "
  />
</template>
