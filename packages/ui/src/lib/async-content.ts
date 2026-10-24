import { defineAsyncComponent, defineComponent, h, type AsyncComponentLoader, type Component } from 'vue';
import ContentSkeleton from '../components/ContentSkeleton.vue';
import AsyncContentError from '../components/AsyncContentError.vue';

/** Covers code downloads only. Mounted data queries keep their own local loading boundary. */
export function defineAsyncContent(
  loader: AsyncComponentLoader<Component>,
  layout: 'page' | 'panel' | 'table' | 'authorization' = 'panel'
) {
  return defineAsyncComponent({
    loader,
    delay: 150,
    loadingComponent: defineComponent({ setup: () => () => h(ContentSkeleton, { layout }) }),
    errorComponent: AsyncContentError as Component
  });
}
