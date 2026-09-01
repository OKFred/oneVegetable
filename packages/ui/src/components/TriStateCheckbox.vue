<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Check, Minus } from '@lucide/vue';

type CheckboxVariant = 'default' | 'overlay';

const props = withDefaults(
  defineProps<{
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    label: string;
    title?: string | undefined;
    variant?: CheckboxVariant;
  }>(),
  { indeterminate: false, disabled: false, title: undefined, variant: 'default' }
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
  <span
    class="relative inline-grid shrink-0 align-middle"
    :class="variant === 'overlay' ? 'size-7' : 'size-4'"
    :data-variant="variant"
    :data-state="indeterminate && !checked ? 'indeterminate' : checked ? 'checked' : 'unchecked'"
  >
    <input
      ref="input"
      type="checkbox"
      class="peer absolute inset-0 z-10 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
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
    <span
      aria-hidden="true"
      class="pointer-events-none grid size-full place-items-center transition-[background-color,border-color,box-shadow,opacity] peer-hover:border-primary/70 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-50"
      :class="[
        variant === 'overlay'
          ? 'rounded-md border shadow-lg backdrop-blur-sm'
          : 'rounded-sm border shadow-sm',
        checked || indeterminate
          ? 'border-primary bg-primary text-primary-foreground ring-0'
          : variant === 'overlay'
            ? 'border-transparent bg-black/45 text-transparent ring-2 ring-inset ring-white/90 peer-hover:bg-black/60'
            : 'border-input bg-background text-transparent'
      ]"
    >
      <Minus v-if="indeterminate && !checked" :class="variant === 'overlay' ? 'size-4' : 'size-3'" />
      <Check v-else-if="checked" :class="variant === 'overlay' ? 'size-4' : 'size-3'" :stroke-width="3" />
    </span>
  </span>
</template>
