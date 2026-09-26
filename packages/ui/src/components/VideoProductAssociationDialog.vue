<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Product } from '@one-vegetable/core';
import type { Video } from '@one-vegetable/core/video';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { resolveVideoProductTarget, type VideoProductTarget } from '../lib/video-library';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { useVideoI18n } from '../i18n/video';
import ModalDialog from './ui/ModalDialog.vue';
import Button from './ui/Button.vue';
import ErrorNotice from './ErrorNotice.vue';
import ProductPicker from './ProductPicker.vue';
import ProductVideoAssociation from './ProductVideoAssociation.vue';

const props = defineProps<{ target: VideoProductTarget | null }>();
const emit = defineEmits<{ close: [] }>();
const { gateway, mode } = useServices();
const { alibabaLanguage } = useAppPreferences();
const vt = useVideoI18n();
const video = shallowRef<Video | null>(null);
const product = shallowRef<Product | null>(null);
const error = shallowRef<unknown>(null);
const loading = ref(false),
  busy = ref(false);
let generation = 0;

async function load(): Promise<void> {
  if (busy.value) return;
  const target = props.target,
    ticket = ++generation;
  video.value = product.value = null;
  error.value = null;
  if (!target) return;
  loading.value = true;
  try {
    const found = await resolveVideoProductTarget(gateway, mode, alibabaLanguage.value, target);
    if (ticket === generation) video.value = found;
  } catch (cause) {
    if (ticket === generation) error.value = cause;
  } finally {
    if (ticket === generation) loading.value = false;
  }
}
function close(): void {
  if (!busy.value) emit('close');
}
function recheck(): void {
  // Remain bound to the original account; never silently select a new target.
  void load();
}
watch([() => props.target, alibabaLanguage], recheck, { immediate: true });
onMounted(() => {
  globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, recheck);
});
onBeforeUnmount(() => {
  generation++;
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, recheck);
});
</script>
<template>
  <ModalDialog
    :open="!!target"
    :title="vt('useInProduct')"
    :description="vt('productSelectionNotice')"
    size="lg"
    :dismissible="!busy"
    @update:open="!$event && close()"
  >
    <p v-if="loading" role="status">{{ vt('loading') }}</p>
    <ErrorNotice v-if="error" :error="error" />
    <Button v-if="error" variant="outline" @click="load">{{ vt('retry') }}</Button>
    <template v-if="video && target">
      <p class="mb-4 break-words text-sm">{{ video.title ?? '—' }} · {{ video.id }}</p>
      <ProductPicker v-if="!product" :expected-identity="target.identity" @select="product = $event" />
      <template v-else>
        <div class="flex items-center gap-3 rounded border p-3" data-testid="video-target-product">
          <div class="min-w-0 flex-1">
            <p class="break-words font-medium">{{ product.subject }}</p>
            <code class="text-xs">{{ product.id }}</code>
          </div>
          <Button variant="outline" :disabled="busy" @click="product = null">{{
            vt('changeProduct')
          }}</Button>
        </div>
        <ProductVideoAssociation
          :key="product.id"
          :product-id="product.id"
          :language="alibabaLanguage"
          :preset="{ video, identity: target.identity }"
          @busy="busy = $event"
        />
      </template>
    </template>
  </ModalDialog>
</template>
