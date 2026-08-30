<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue';

import Button from './ui/Button.vue';
import Card from './ui/Card.vue';

const props = defineProps<{
  title: string;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  'update:collapsed': [collapsed: boolean];
}>();
</script>

<template>
  <Card
    class="flex h-fit flex-col overflow-hidden p-2 transition-[width] duration-200 lg:sticky lg:top-20 lg:z-10 lg:max-h-[calc(100vh-6rem)] lg:self-start"
    :class="props.collapsed ? 'w-[3.25rem] lg:w-auto' : 'w-full'"
  >
    <div class="flex items-center" :class="props.collapsed ? 'justify-center' : 'justify-between gap-2'">
      <p
        v-if="!props.collapsed"
        class="min-w-0 truncate px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {{ props.title }}
      </p>
      <Button
        variant="ghost"
        size="icon"
        class="size-8 shrink-0"
        :aria-label="`${props.collapsed ? '展开' : '收起'}${props.title}`"
        :title="`${props.collapsed ? '展开' : '收起'}${props.title}`"
        @click="emit('update:collapsed', !props.collapsed)"
      >
        <ChevronRight v-if="props.collapsed" class="size-4" />
        <ChevronLeft v-else class="size-4" />
      </Button>
    </div>
    <div v-if="!props.collapsed" class="mt-1 min-h-0 lg:overflow-y-auto">
      <slot />
    </div>
  </Card>
</template>
