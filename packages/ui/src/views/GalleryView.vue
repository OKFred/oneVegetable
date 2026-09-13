<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue';
import { useVideoI18n } from '../i18n/video';
import { parseAppHash } from '../lib/hash-router';
const vt = useVideoI18n();
const Videos = defineAsyncComponent(() => import('./VideosView.vue'));
const Photos = defineAsyncComponent(() => import('./PhotosView.vue'));
const isVideo = ref(parseAppHash(globalThis.location.hash)?.segments[0] === 'videos');
const update = () => {
  isVideo.value = parseAppHash(globalThis.location.hash)?.segments[0] === 'videos';
};
onMounted(() => {
  globalThis.addEventListener('hashchange', update);
});
onUnmounted(() => {
  globalThis.removeEventListener('hashchange', update);
});
</script>
<template>
  <div class="space-y-3">
    <nav class="flex gap-2 border-b pb-2" :aria-label="vt('title')">
      <a
        href="#/photos"
        class="rounded px-4 py-2 text-sm hover:bg-muted"
        :class="!isVideo ? 'bg-muted font-semibold' : ''"
        :aria-current="!isVideo ? 'page' : undefined"
        >{{ vt('pictures') }}</a
      >
      <a
        href="#/photos/videos"
        class="rounded px-4 py-2 text-sm hover:bg-muted"
        :class="isVideo ? 'bg-muted font-semibold' : ''"
        :aria-current="isVideo ? 'page' : undefined"
        >{{ vt('videos') }}</a
      >
    </nav>
    <Videos v-if="isVideo" /><Photos v-else />
  </div>
</template>
