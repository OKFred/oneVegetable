<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { toast } from 'vue-sonner';
import {
  VIDEO_LIBRARY_URL,
  safeVideoUrl,
  safePlaybackUrl,
  type Video,
  type VideoRelations,
  type VideoProductResolution
} from '@one-vegetable/core/video';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { requestVideo, VideoReadScope, mustStopVideoQueries } from '../lib/video-library';
import { useVideoI18n } from '../i18n/video';
import { formatDateTime } from '../lib/date-time';
import Sheet from './ui/Sheet.vue';
import Button from './ui/Button.vue';
import ErrorNotice from './ErrorNotice.vue';
import TablePagination from './TablePagination.vue';
const props = defineProps<{ video: Video | null; identity: string }>();
const emit = defineEmits<{ close: [] }>();
const { gateway, mode } = useServices(),
  { alibabaLanguage } = useAppPreferences();
const vt = useVideoI18n();
const section = ref<'information' | 'relations'>('information'),
  type = ref<'main' | 'detail'>('main'),
  page = ref(1);
const player = ref<HTMLVideoElement | null>(null),
  playError = ref(false),
  actualDuration = ref<number | null>(null);
const relation = shallowRef<VideoRelations | null>(null),
  results = shallowRef<Record<string, VideoProductResolution>>({}),
  failures = shallowRef<Record<string, unknown>>({}),
  error = shallowRef<unknown>(null),
  busy = ref(false),
  done = ref(0);
const scope = new VideoReadScope();
const mediaUrl = computed(() => safePlaybackUrl(props.video?.videoUrl));
const ids = computed(
  () => relation.value?.encryptedProductIds.slice((page.value - 1) * 10, page.value * 10) ?? []
);
const fields = [
  'id',
  'encryptedId',
  'status',
  'quality',
  'publishedAt',
  'durationRaw',
  'fileSize',
  'width',
  'height',
  'relatedProductCount',
  'publisher'
] as const;
function release() {
  if (player.value) {
    player.value.pause();
    player.value.removeAttribute('src');
    player.value.load();
  }
}
function stop(notify = false) {
  scope.stop();
  busy.value = false;
  if (notify) toast.info(vt('stopped'));
}
function close() {
  stop();
  release();
  emit('close');
}
async function retryMedia() {
  release();
  playError.value = false;
  actualDuration.value = null;
  await nextTick();
  if (player.value && mediaUrl.value) {
    player.value.src = mediaUrl.value;
    player.value.load();
  }
}
function metadata() {
  const duration = player.value?.duration;
  actualDuration.value = duration !== undefined && Number.isFinite(duration) ? duration : null;
}
async function resolvePage(refresh = false, only?: string) {
  stop();
  const current = scope.capture(),
    identity = props.identity,
    language = alibabaLanguage.value;
  const frozen = only ? [only] : [...ids.value];
  busy.value = true;
  done.value = 0;
  try {
    for (const [index, id] of frozen.entries()) {
      if (!current()) break;
      if (index > 0) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 350));
      if (!current()) break;
      try {
        const value = await requestVideo(
          gateway,
          mode,
          language,
          'resolveVideoRelatedProduct',
          { encryptedProductId: id, language },
          identity,
          refresh
        );
        if (current()) {
          results.value = { ...results.value, [id]: value };
          failures.value = Object.fromEntries(Object.entries(failures.value).filter(([key]) => key !== id));
        }
      } catch (e: unknown) {
        if (current()) {
          failures.value = { ...failures.value, [id]: e };
          if (mustStopVideoQueries(e)) {
            error.value = e;
            break;
          }
        }
      }
      if (current()) done.value++;
    }
    if (current() && frozen.length && done.value === frozen.length) toast.info(vt('finish'));
  } finally {
    if (current()) busy.value = false;
  }
}
async function loadRelations(refresh = false) {
  stop();
  relation.value = null;
  results.value = {};
  failures.value = {};
  error.value = null;
  page.value = 1;
  if (!props.video?.encryptedId) return;
  const current = scope.capture();
  busy.value = true;
  try {
    const data = await requestVideo(
      gateway,
      mode,
      alibabaLanguage.value,
      'listVideoRelatedProducts',
      { videoId: props.video.encryptedId, type: type.value },
      props.identity,
      refresh
    );
    if (!current()) return;
    relation.value = data;
    // Separate the relation query from the first decrypt request as well.
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 350));
    if (current()) await resolvePage(refresh);
  } catch (e: unknown) {
    if (current()) error.value = e;
  } finally {
    if (current()) busy.value = false;
  }
}
function changePage(value: number) {
  page.value = value;
  void resolvePage();
}
watch(
  () => props.video,
  () => {
    stop();
    release();
    section.value = 'information';
    type.value = 'main';
    page.value = 1;
    relation.value = null;
    results.value = {};
    failures.value = {};
    error.value = null;
    playError.value = false;
    actualDuration.value = null;
  },
  { flush: 'sync' }
);
watch([section, type, alibabaLanguage], () => {
  if (section.value === 'relations' && props.video) {
    player.value?.pause();
    void loadRelations();
  } else stop();
});
watch(
  () => props.identity,
  () => {
    stop();
    results.value = {};
    relation.value = null;
  }
);
onBeforeUnmount(() => {
  stop();
  release();
});
</script>
<template>
  <Sheet
    :open="!!video"
    :title="video?.title ?? vt('title')"
    :description="video?.id ?? ''"
    @update:open="!$event && close()"
  >
    <template #toolbar
      ><div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          :aria-pressed="section === 'information'"
          @click="section = 'information'"
          >{{ vt('information') }}</Button
        ><Button
          variant="outline"
          :disabled="!video?.encryptedId"
          :aria-pressed="section === 'relations'"
          @click="section = 'relations'"
          >{{ vt('relations') }}</Button
        ><a
          :href="VIDEO_LIBRARY_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="self-center text-sm text-primary underline"
          >{{ vt('official') }}</a
        >
      </div></template
    >
    <div v-if="video" class="space-y-4">
      <section v-show="section === 'information'" class="space-y-3">
        <video
          v-if="mediaUrl"
          ref="player"
          :key="video.encryptedId ?? video.id ?? ''"
          :src="mediaUrl"
          :poster="safeVideoUrl(video.coverUrl) ?? undefined"
          class="max-h-[45vh] w-full rounded bg-black"
          controls
          playsinline
          preload="none"
          @error="playError = true"
          @loadedmetadata="metadata"
        />
        <p v-else>{{ vt('unavailable') }}</p>
        <p v-if="playError" role="alert" class="text-destructive">{{ vt('playError') }}</p>
        <div v-if="mediaUrl" class="flex items-center gap-3">
          <Button v-if="playError" variant="outline" @click="retryMedia">{{ vt('retry') }}</Button
          ><a
            :href="mediaUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-primary underline"
            >{{ vt('original') }}</a
          >
        </div>
        <p v-if="actualDuration !== null">{{ vt('durationActual') }}: {{ actualDuration }}</p>
        <p class="text-xs text-muted-foreground">{{ vt('rawNotice') }}</p>
        <dl class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-sm">
          <template v-for="field in fields" :key="field"
            ><dt class="text-muted-foreground">{{ vt(field === 'id' ? 'idSearch' : field) }}</dt>
            <dd class="break-all" :class="field === 'publishedAt' ? 'whitespace-nowrap' : ''">
              {{
                field === 'publishedAt'
                  ? video.publishedAt === null
                    ? '—'
                    : formatDateTime(video.publishedAt)
                  : (video[field] ?? '—')
              }}
            </dd></template
          >
        </dl>
      </section>
      <section v-if="section === 'relations'" class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" :aria-pressed="type === 'main'" @click="type = 'main'">{{
            vt('main')
          }}</Button
          ><Button variant="outline" :aria-pressed="type === 'detail'" @click="type = 'detail'">{{
            vt('detail')
          }}</Button
          ><Button variant="outline" :disabled="busy" @click="loadRelations(true)">{{ vt('refresh') }}</Button
          ><Button v-if="busy" variant="outline" @click="stop(true)">{{ vt('stop') }}</Button
          ><Button v-else-if="ids.some((id) => !results[id])" variant="outline" @click="resolvePage()">{{
            vt('retry')
          }}</Button>
        </div>
        <p aria-live="polite">
          {{ busy ? vt('loading') : '' }} {{ vt('progress', { done, total: ids.length }) }}
        </p>
        <ErrorNotice v-if="error" :error="error" />
        <details v-if="relation?.issues.length" class="text-xs">
          <summary class="cursor-pointer">{{ vt('issues') }}</summary>
          <p v-for="issue in relation.issues" :key="issue">{{ issue }}</p>
        </details>
        <p v-if="relation && !relation.encryptedProductIds.length">{{ vt('noRelations') }}</p>
        <article v-for="id in ids" :key="id" class="space-y-2 rounded border p-3">
          <p class="break-all text-xs text-muted-foreground">{{ vt('linkedId') }}: {{ id }}</p>
          <template v-if="results[id]">
            <div v-if="results[id]?.product" class="flex items-center gap-3">
              <img
                v-if="results[id]?.product?.imageUrl"
                :src="results[id]?.product?.imageUrl ?? ''"
                alt=""
                class="h-16 w-20 rounded object-contain"
                loading="lazy"
                referrerpolicy="no-referrer"
              />
              <div>
                <p>{{ results[id]?.product?.subject }}</p>
                <p class="text-xs">{{ results[id]?.productId }} · {{ results[id]?.product?.status }}</p>
                <a
                  v-if="results[id]?.product?.detailUrl"
                  :href="results[id]?.product?.detailUrl ?? ''"
                  class="text-primary underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ vt('productLink') }}</a
                >
              </div>
            </div>
            <p v-else>{{ vt(results[id]?.status === 'invalid-id' ? 'invalidId' : 'notFound') }}</p>
            <details v-if="results[id]?.issues.length" class="text-xs">
              <summary class="cursor-pointer">{{ vt('issues') }}</summary>
              <p v-for="issue in results[id]?.issues" :key="issue">{{ issue }}</p>
            </details>
          </template>
          <p v-else-if="!failures[id]">{{ vt('pending') }}</p>
          <ErrorNotice v-if="failures[id]" :error="failures[id]" compact />
          <Button v-if="failures[id]" variant="outline" :disabled="busy" @click="resolvePage(true, id)">{{
            vt('retry')
          }}</Button>
        </article>
        <TablePagination
          v-if="relation"
          :page="page"
          :page-size="10"
          :total="relation.encryptedProductIds.length"
          :page-size-options="[10]"
          @update:page="changePage"
        />
      </section>
    </div>
  </Sheet>
</template>
