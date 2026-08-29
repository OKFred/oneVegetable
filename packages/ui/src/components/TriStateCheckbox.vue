<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    label: string;
    title?: string | undefined;
  }>(),
  { indeterminate: false, disabled: false, title: undefined }
);
const emit = defineEmits<{ 'update:checked': [checked: boolean] }>();
const input = ref<HTMLInputElement | null>(null);

function syncIndeterminate(): void {
  if (input.value) input.value.indeterminate = props.indeterminate && !props.checked;
}

onMounted(syncIndeterminate);
watch(() => [props.checked, props.indeterminate], syncIndeterminate, { flush: 'post' });

function updateChecked(event: Event): void {
  emit('update:checked', (event.currentTarget as HTMLInputElement).checked);
}
</script>

<template>
  <input
    ref="input"
    type="checkbox"
    class="size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
    :checked="checked"
    :disabled="disabled"
    :aria-label="label"
    :aria-checked="indeterminate && !checked ? 'mixed' : checked"
    :title="title"
    @click.stop
    @keydown.enter.stop
    @keydown.space.stop
    @change="updateChecked"
  />
</template>
