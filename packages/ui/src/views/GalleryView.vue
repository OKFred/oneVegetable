<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { defineAsyncContent } from '../lib/async-content';
import { useVideoI18n } from '../i18n/video';
import { useUiI18n } from '../i18n';
import { parseAppHash } from '../lib/hash-router';
const props = withDefaults(defineProps<{ filesAllowed?: boolean }>(), { filesAllowed: true });
const vt = useVideoI18n();
const { t } = useUiI18n();
const Videos = defineAsyncContent(() => import('./VideosView.vue'), 'page');
const Photos = defineAsyncContent(() => import('./PhotosView.vue'), 'page');
const Files = defineAsyncContent(() => import('./FilesView.vue'), 'page');
const route = ref(parseAppHash(globalThis.location.hash));
const activeTab = computed(() => {
  if (route.value?.page === 'files') return props.filesAllowed ? 'files' : 'photos';
  return route.value?.segments[0] === 'videos' ? 'videos' : 'photos';
});
const update = () => {
  route.value = parseAppHash(globalThis.location.hash);
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
    <nav data-testid="assets-tabs" class="flex gap-2 border-b pb-2" :aria-label="vt('assets')">
      <a
        href="#/photos"
        class="rounded px-4 py-2 text-sm hover:bg-muted"
        :class="activeTab === 'photos' ? 'bg-muted font-semibold' : ''"
        :aria-current="activeTab === 'photos' ? 'page' : undefined"
        >{{ vt('pictures') }}</a
      >
      <a
        href="#/photos/videos"
        class="rounded px-4 py-2 text-sm hover:bg-muted"
        :class="activeTab === 'videos' ? 'bg-muted font-semibold' : ''"
        :aria-current="activeTab === 'videos' ? 'page' : undefined"
        >{{ vt('videos') }}</a
      >
      <a
        v-if="filesAllowed"
        href="#/files"
        class="rounded px-4 py-2 text-sm hover:bg-muted"
        :class="activeTab === 'files' ? 'bg-muted font-semibold' : ''"
        :aria-current="activeTab === 'files' ? 'page' : undefined"
        >{{ t('shell.navigation.files') }}</a
      >
    </nav>
    <Videos v-if="activeTab === 'videos'" /><Files v-else-if="activeTab === 'files'" /><Photos v-else />
  </div>
</template>
