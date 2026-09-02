<script setup lang="ts">
import { AvatarImage } from 'reka-ui';

import { cn } from '../../lib/utils';

const props = withDefaults(
  defineProps<{
    src: string;
    alt: string;
    class?: string;
    referrerPolicy?:
      'no-referrer' | 'origin' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin';
  }>(),
  { class: '', referrerPolicy: 'no-referrer' }
);
</script>

<template>
  <AvatarImage
    data-slot="avatar-image"
    :src="props.src"
    :alt="props.alt"
    :referrer-policy="props.referrerPolicy"
    :class="cn('aspect-square size-full object-cover', props.class)"
  />
</template>
