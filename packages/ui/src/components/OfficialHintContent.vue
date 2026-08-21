<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { ChevronDown, MapPin } from '@lucide/vue';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';

import type { ProductSchemaOfficialHint } from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';

const props = withDefaults(
  defineProps<{
    hint: ProductSchemaOfficialHint;
    compact?: boolean;
    showLocate?: boolean;
  }>(),
  { compact: false, showLocate: true }
);
const emit = defineEmits<{ locate: [] }>();

const open = ref(false);
const content = ref<HTMLElement | null>(null);
const canLocate = computed(() => props.showLocate && props.hint.fieldKeys.length > 0);

watchEffect(() => {
  if (content.value) content.value.innerHTML = props.hint.html;
});
</script>

<template>
  <CollapsibleRoot
    v-model:open="open"
    class="rounded-md"
    :class="compact ? 'text-xs' : 'border bg-background p-3 text-sm'"
  >
    <div class="flex flex-wrap items-start justify-between gap-2">
      <p class="min-w-0 flex-1 leading-6" :class="compact ? 'text-muted-foreground' : 'font-medium'">
        {{ hint.summary }}
      </p>
      <div class="flex shrink-0 items-center gap-1">
        <Badge v-if="hint.occurrenceCount > 1" variant="outline"> 重复 {{ hint.occurrenceCount }} 次 </Badge>
        <Button
          v-if="canLocate"
          type="button"
          variant="ghost"
          size="sm"
          :aria-label="`定位字段：${hint.rootFieldName}`"
          @click="emit('locate')"
        >
          <MapPin class="size-3.5" />定位字段
        </Button>
        <CollapsibleTrigger v-if="hint.hasRichContent" as-child>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :aria-label="`${open ? '收起' : '展开'}官方提示：${hint.summary}`"
          >
            {{ open ? '收起' : '展开' }}
            <ChevronDown class="size-3.5 transition-transform" :class="open ? 'rotate-180' : ''" />
          </Button>
        </CollapsibleTrigger>
      </div>
    </div>
    <CollapsibleContent v-if="hint.hasRichContent" class="official-hint-collapsible overflow-hidden">
      <div ref="content" class="official-hint-content mt-3 border-t pt-3 text-muted-foreground"></div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
.official-hint-content {
  overflow-wrap: anywhere;
}

.official-hint-content :deep(p) {
  margin-top: 0.375rem;
}

.official-hint-content :deep(a) {
  color: hsl(var(--primary));
  text-decoration: underline;
  text-underline-offset: 2px;
}

.official-hint-content :deep(ul),
.official-hint-content :deep(ol) {
  margin: 0.5rem 0;
  padding-left: 1.25rem;
}

.official-hint-content :deep(ul) {
  list-style: disc;
}

.official-hint-content :deep(ol) {
  list-style: decimal;
}

.official-hint-content :deep(pre) {
  margin-top: 0.5rem;
  max-height: 18rem;
  overflow: auto;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--muted) / 0.65);
  padding: 0.75rem;
  color: hsl(var(--foreground));
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre;
}

.official-hint-collapsible[data-state='open'] {
  animation: ov-hint-expand 180ms ease-out;
}

.official-hint-collapsible[data-state='closed'] {
  animation: ov-hint-collapse 160ms ease-in;
}

@keyframes ov-hint-expand {
  from {
    height: 0;
    opacity: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }
}

@keyframes ov-hint-collapse {
  from {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }
  to {
    height: 0;
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .official-hint-collapsible,
  .official-hint-collapsible * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
