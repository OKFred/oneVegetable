<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { safeVideoId, type Video, type VideoPage } from '@one-vegetable/core/video';
import { useServices } from '../lib/services';
import { requestVideo, VideoReadScope } from '../lib/video-library';
import { useVideoI18n } from '../i18n/video';
import { useUiI18n } from '../i18n';
import { GatewayException } from '@one-vegetable/core/errors';
import VideoDrawer from './VideoDrawer.vue';
import ActionTooltip from './ActionTooltip.vue';
import ErrorNotice from './ErrorNotice.vue';
import TablePagination from './TablePagination.vue';
import Input from './ui/Input.vue';
import Button from './ui/Button.vue';

const props = defineProps<{ identity: string; language: 'zh_CN' | 'en_US'; disabled?: boolean }>();
const emit = defineEmits<{ select: [video: Video] }>();
const { gateway, mode, operationAvailability } = useServices();
const vt = useVideoI18n();
const { t } = useUiI18n();
const title = ref(''),
  id = ref(''),
  page = ref(1),
  pageSize = ref<20 | 50>(20);
const submitted = shallowRef({ title: '', id: '' });
const titlePageFilterOnly = ref(false);
const result = shallowRef<VideoPage | null>(null),
  preview = shallowRef<Video | null>(null);
const error = shallowRef<unknown>(null),
  busy = ref(false);
const scope = new VideoReadScope();
const rows = computed(() =>
  (result.value?.items ?? []).filter(
    (video) =>
      !titlePageFilterOnly.value ||
      !submitted.value.title ||
      (video.title ?? '').toLocaleLowerCase().includes(submitted.value.title.toLocaleLowerCase())
  )
);
async function load(refresh = false) {
  scope.stop();
  const current = scope.capture();
  result.value = null;
  preview.value = null;
  error.value = null;
  busy.value = true;
  try {
    if (!props.identity) return;
    const availability = await operationAvailability?.get(['listVideos']);
    if (!current()) return;
    const decision = availability?.items.find((item) => item.operation === 'listVideos');
    if (decision && !decision.allowed) {
      const code = decision.reasonCode ?? 'OPERATION_AVAILABILITY_UNAVAILABLE';
      throw new GatewayException({ code, message: code, retryable: false });
    }
    titlePageFilterOnly.value =
      decision?.protocolSupport?.constraints.includes('video-title-page-filter-only') === true;
    const data = await requestVideo(
      gateway,
      mode,
      props.language,
      'listVideos',
      {
        page: page.value,
        pageSize: pageSize.value,
        ...(submitted.value.title && !titlePageFilterOnly.value ? { title: submitted.value.title } : {}),
        ...(submitted.value.id ? { id: submitted.value.id } : {})
      },
      props.identity,
      refresh
    );
    if (current()) result.value = data;
  } catch (cause) {
    if (current()) error.value = cause;
  } finally {
    if (current()) busy.value = false;
  }
}
function search() {
  if (id.value.trim() && !safeVideoId(id.value.trim())) {
    error.value = new Error(vt('idInvalid'));
    return;
  }
  submitted.value = { title: title.value.trim(), id: id.value.trim() };
  page.value = 1;
}
function selectable(video: Video) {
  return !!safeVideoId(video.id) && !!video.encryptedId;
}
watch(
  [page, pageSize, submitted, () => props.identity, () => props.language],
  () => {
    void load();
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  scope.stop();
});
</script>
<template>
  <div class="space-y-3" data-testid="video-picker">
    <form class="flex flex-wrap gap-2" @submit.prevent="search">
      <Input
        v-model="title"
        :aria-label="vt('titleSearch')"
        :placeholder="vt('titleSearch')"
        maxlength="200"
        class="max-w-xs"
      />
      <Input
        v-model="id"
        :aria-label="vt('idSearch')"
        :placeholder="vt('idSearch')"
        inputmode="numeric"
        class="max-w-52"
      />
      <Button type="submit" variant="outline" :disabled="busy">{{ vt('search') }}</Button>
      <Button variant="outline" :disabled="busy" @click="load(true)">{{ vt('refresh') }}</Button>
    </form>
    <p v-if="titlePageFilterOnly" class="text-xs text-muted-foreground">{{ t('common.filters.pageHint') }}</p>
    <ErrorNotice v-if="error" :error="error" media-feature="videos" compact />
    <p v-if="busy" role="status">{{ vt('loading') }}</p>
    <p v-else-if="result && rows.length === 0">
      {{ titlePageFilterOnly && submitted.title ? t('common.filters.pageNoMatch') : vt('empty') }}
    </p>
    <ul class="max-h-80 space-y-2 overflow-auto">
      <li
        v-for="(video, index) in rows"
        :key="video.encryptedId ?? index"
        class="flex items-center gap-3 rounded border p-3"
      >
        <img
          v-if="video.coverUrl"
          :src="video.coverUrl"
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
          class="h-12 w-20 object-contain"
        />
        <div class="min-w-0 flex-1">
          <p class="line-clamp-2">{{ video.title ?? '—' }}</p>
          <code>{{ video.id ?? '—' }}</code>
        </div>
        <Button variant="outline" @click="preview = video">{{ vt('view') }}</Button>
        <ActionTooltip :disabled="!selectable(video)" :reason="vt('associationInvalidVideo')">
          <Button
            data-testid="choose-video"
            :disabled="disabled || busy || !selectable(video)"
            @click="emit('select', video)"
            >{{ vt('associationChoose') }}</Button
          >
        </ActionTooltip>
      </li>
    </ul>
    <TablePagination
      v-if="result && result.total !== null"
      v-model:page="page"
      :page-size="pageSize"
      :total="result.total"
      :page-size-options="[20, 50]"
      :disabled="busy"
      @update:page-size="
        pageSize = $event === 50 ? 50 : 20;
        page = 1;
      "
    />
    <p v-else-if="result">{{ vt('totalUnknown') }}</p>
    <VideoDrawer :video="preview" :identity="identity" @close="preview = null" />
  </div>
</template>
