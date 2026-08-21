<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';

import { sanitizeProductDescriptionHtml } from '@one-vegetable/core/browser';

const props = defineProps<{ html: string }>();
const container = ref<HTMLElement | null>(null);
const safeHtml = computed(() => sanitizeProductDescriptionHtml(props.html).html);

watchEffect(() => {
  if (container.value) container.value.innerHTML = safeHtml.value;
});
</script>

<template>
  <div ref="container" class="safe-html-content"></div>
</template>

<style scoped>
.safe-html-content :deep(p),
.safe-html-content :deep(div) {
  margin-top: 0.25rem;
}

.safe-html-content :deep(a) {
  color: hsl(var(--primary));
  text-decoration: underline;
  text-underline-offset: 2px;
}

.safe-html-content :deep(ul),
.safe-html-content :deep(ol) {
  margin: 0.25rem 0;
  padding-left: 1.25rem;
}

.safe-html-content :deep(img) {
  max-width: min(100%, 24rem);
  height: auto;
}
</style>
