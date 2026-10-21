import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

// Portals retain their original DOM positions, even when opened much later.
// Visual order must follow activation order, just like Reka's focus scopes.
const activeLayers = shallowRef<symbol[]>([]);
const BASE_LAYER = 60;
const LAYER_STEP = 2;

export function useDialogLayer(open: () => boolean) {
  const id = Symbol('dialog-layer');
  const lastLayer = ref(BASE_LAYER);
  const position = computed(() => activeLayers.value.indexOf(id));
  const level = computed(() =>
    position.value < 0 ? lastLayer.value : BASE_LAYER + position.value * LAYER_STEP
  );
  const isTopmost = computed(() => open() && activeLayers.value.at(-1) === id);

  function release(): void {
    if (position.value < 0) return;
    // Retain the exit animation's layer until the portal content disappears.
    lastLayer.value = level.value;
    activeLayers.value = activeLayers.value.filter((layer) => layer !== id);
  }

  watch(
    open,
    (value) => {
      if (value && position.value < 0) activeLayers.value = [...activeLayers.value, id];
      else if (!value) release();
    },
    { immediate: true, flush: 'sync' }
  );
  onScopeDispose(release);

  function preventBackgroundDismiss(event: Event): void {
    if (!isTopmost.value) event.preventDefault();
  }

  return {
    overlayStyle: computed(() => ({ zIndex: level.value })),
    contentStyle: computed(() => ({ zIndex: level.value + 1 })),
    isTopmost,
    preventBackgroundDismiss
  };
}
