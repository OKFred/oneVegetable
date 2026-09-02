<script setup lang="ts">
import { computed } from 'vue';
import { AvatarFallback } from 'reka-ui';

import { cn } from '../../lib/utils';

const props = withDefaults(defineProps<{ class?: string; delayMs?: number }>(), {
  class: '',
  delayMs: -1
});
const delegatedProps = computed<{ delayMs?: number }>(() =>
  props.delayMs < 0 ? {} : { delayMs: props.delayMs }
);
</script>

<template>
  <AvatarFallback
    v-bind="delegatedProps"
    data-slot="avatar-fallback"
    :class="cn('flex size-full items-center justify-center rounded-full bg-muted font-medium', props.class)"
  >
    <slot />
  </AvatarFallback>
</template>
