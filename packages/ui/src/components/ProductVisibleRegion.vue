<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const emit = defineEmits<{ visible: [visible: boolean] }>();
const element = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | undefined;
let intersecting = false;
function report(): void {
  emit('visible', props.active && intersecting && globalThis.document.visibilityState !== 'hidden');
}
watch(() => props.active, report);
onMounted(() => {
  // Without a reliable viewport signal, keep reads explicit rather than loading the entire page.
  if (typeof IntersectionObserver !== 'undefined' && element.value) {
    observer = new IntersectionObserver((entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting);
      report();
    });
    observer.observe(element.value);
  }
  globalThis.document.addEventListener('visibilitychange', report);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  globalThis.document.removeEventListener('visibilitychange', report);
  emit('visible', false);
});
</script>

<template>
  <div ref="element"><slot /></div>
</template>
