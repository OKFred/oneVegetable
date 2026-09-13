<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { Film, RefreshCw, Search } from '@lucide/vue';
import { safeVideoId, type Video, type VideoPage } from '@one-vegetable/core/video';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { pageDetailIdentity } from '../lib/page-details';
import { requestVideo, VideoReadScope } from '../lib/video-library';
import { useVideoI18n } from '../i18n/video';
import { formatDateTime } from '../lib/date-time';
import type { DataColumn } from '../lib/table';
import Button from '../components/ui/Button.vue';
import Input from '../components/ui/Input.vue';
import DataTable from '../components/DataTable.vue';
import TablePagination from '../components/TablePagination.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import VideoDrawer from '../components/VideoDrawer.vue';
const { gateway, mode } = useServices();
const { alibabaLanguage } = useAppPreferences();
const vt = useVideoI18n();
const title = ref(''),
  id = ref(''),
  page = ref(1),
  pageSize = ref<20 | 50>(20),
  view = ref<'cards' | 'list'>('cards');
const submitted = ref({ title: '', id: '' });
const result = shallowRef<VideoPage | null>(null),
  selected = shallowRef<Video | null>(null),
  error = shallowRef<unknown>(null),
  busy = ref(false),
  identity = ref('');
const scope = new VideoReadScope();
const rows = computed(() => result.value?.items ?? []);
async function load(refresh = false) {
  scope.stop();
  const current = scope.capture();
  busy.value = true;
  error.value = null;
  result.value = null;
  selected.value = null;
  const language = alibabaLanguage.value;
  try {
    const account = await pageDetailIdentity(gateway, mode);
    if (!current()) return;
    identity.value = account;
    const data = await requestVideo(
      gateway,
      mode,
      language,
      'listVideos',
      {
        page: page.value,
        pageSize: pageSize.value,
        ...(submitted.value.title ? { title: submitted.value.title } : {}),
        ...(submitted.value.id ? { id: submitted.value.id } : {})
      },
      account,
      refresh
    );
    if (current()) result.value = data;
  } catch (e: unknown) {
    if (current()) error.value = e;
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
  void load();
}
function setPage(value: number) {
  if (page.value === value) return;
  page.value = value;
  void load();
}
function setSize(value: number) {
  pageSize.value = value === 50 ? 50 : 20;
  page.value = 1;
  void load();
}
const fieldKeys = [
  'status',
  'quality',
  'publishedAt',
  'durationRaw',
  'fileSize',
  'width',
  'height',
  'relatedProductCount',
  'publisher',
  'encryptedId'
] as const;
const columns = computed<DataColumn<Video>[]>(() => [
  {
    id: 'coverUrl',
    header: vt('coverUrl'),
    cell: ({ row }) =>
      row.original.coverUrl
        ? h('img', {
            src: row.original.coverUrl,
            alt: '',
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
            class: 'h-16 w-24 rounded object-contain'
          })
        : '—',
    meta: { width: '112px' }
  },
  {
    id: 'name',
    header: vt('name'),
    cell: ({ row }) =>
      h('div', { class: 'max-w-80' }, [
        h('p', { class: 'line-clamp-2' }, row.original.title ?? '—'),
        h('p', { class: 'text-xs text-muted-foreground' }, row.original.id ?? '—')
      ])
  },
  ...fieldKeys.map((key) => ({
    id: key,
    header: vt(key),
    cell: ({ row }: { row: { original: Video } }) =>
      h(
        'span',
        { class: 'whitespace-nowrap' },
        key === 'publishedAt'
          ? row.original.publishedAt === null
            ? '—'
            : formatDateTime(row.original.publishedAt)
          : String(row.original[key] ?? '—')
      )
  })),
  {
    id: 'actions',
    header: vt('actions'),
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: 'outline',
          onClick: (e: Event) => {
            e.stopPropagation();
            selected.value = row.original;
          }
        },
        () => vt('view')
      )
  }
]);
async function checkIdentity() {
  try {
    if (identity.value && (await pageDetailIdentity(gateway, mode)) !== identity.value) {
      scope.stop();
      selected.value = null;
      result.value = null;
      void load(true);
    }
  } catch (e: unknown) {
    scope.stop();
    selected.value = null;
    result.value = null;
    error.value = e;
    busy.value = false;
  }
}
const focus = () => {
  void checkIdentity();
};
watch(alibabaLanguage, () => {
  page.value = 1;
  void load();
});
onMounted(() => {
  void load();
  globalThis.addEventListener('focus', focus);
});
onUnmounted(() => {
  scope.stop();
  globalThis.removeEventListener('focus', focus);
});
</script>
<template>
  <section class="space-y-3" data-testid="video-library">
    <h2 class="text-xl font-semibold">{{ vt('title') }}</h2>
    <form class="flex flex-wrap items-center gap-2" @submit.prevent="search">
      <Input
        v-model="title"
        :aria-label="vt('titleSearch')"
        :placeholder="vt('titleSearch')"
        class="max-w-xs"
        maxlength="200"
        @keydown.enter.prevent="search"
      />
      <Input
        v-model="id"
        :aria-label="vt('idSearch')"
        :placeholder="vt('idSearch')"
        class="max-w-52"
        inputmode="numeric"
        @keydown.enter.prevent="search"
      />
      <Button type="submit" :disabled="busy"><Search class="size-4" />{{ vt('search') }}</Button>
      <Button variant="outline" :disabled="busy" @click="load(true)"
        ><RefreshCw class="size-4" />{{ vt('refresh') }}</Button
      >
      <div class="ml-auto flex gap-1">
        <Button variant="outline" :aria-pressed="view === 'cards'" @click="view = 'cards'">{{
          vt('cards')
        }}</Button
        ><Button variant="outline" :aria-pressed="view === 'list'" @click="view = 'list'">{{
          vt('list')
        }}</Button>
      </div>
    </form>
    <ErrorNotice v-if="error" :error="error" />
    <p v-if="busy" role="status">{{ vt('loading') }}</p>
    <details v-if="result?.issues.length" class="text-sm text-muted-foreground">
      <summary class="cursor-pointer">{{ vt('issues') }} ({{ result.issues.length }})</summary>
      <p v-for="issue in result.issues" :key="issue">{{ issue }}</p>
    </details>
    <template v-if="view === 'cards'">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          v-for="(video, index) in rows"
          :key="video.encryptedId ?? index"
          type="button"
          class="overflow-hidden rounded-lg border bg-card text-left transition hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="`${vt('view')}: ${video.title ?? video.id ?? '—'}`"
          @click="selected = video"
        >
          <div class="flex aspect-video items-center justify-center bg-muted">
            <img
              v-if="video.coverUrl"
              :src="video.coverUrl"
              alt=""
              class="size-full object-contain"
              loading="lazy"
              referrerpolicy="no-referrer"
            /><Film v-else class="size-10 text-muted-foreground" />
          </div>
          <div class="space-y-1 p-3">
            <p class="line-clamp-2 font-medium">{{ video.title ?? '—' }}</p>
            <p class="text-xs text-muted-foreground">{{ video.id ?? '—' }}</p>
            <p class="text-xs">{{ vt('status') }}: {{ video.status ?? '—' }}</p>
            <p class="text-xs">{{ vt('quality') }}: {{ video.quality ?? '—' }}</p>
          </div>
        </button>
      </div>
      <p v-if="!busy && !error && !rows.length" class="p-8 text-center text-muted-foreground">
        {{ vt('empty') }}
      </p>
    </template>
    <DataTable
      v-else
      :columns="columns"
      :data="rows"
      :pagination="false"
      :empty-text="vt('empty')"
      column-settings-key="videos"
      :locked-columns="['name', 'actions']"
      :hidden-columns="['durationRaw', 'width', 'height', 'publisher', 'encryptedId']"
      :get-row-key="(video) => video.encryptedId ?? video.id ?? ''"
      :active-row-key="selected?.encryptedId"
      :row-aria-label="(video) => `${vt('view')}: ${video.title ?? video.id ?? '—'}`"
      @row-activate="selected = $event"
    />
    <TablePagination
      v-if="result?.total !== null && result"
      :page="page"
      :page-size="pageSize"
      :total="result.total"
      :page-size-options="[20, 50]"
      :disabled="busy"
      @update:page="setPage"
      @update:page-size="setSize"
    />
    <p v-else-if="result" class="text-muted-foreground">{{ vt('totalUnknown') }}</p>
    <VideoDrawer :video="selected" :identity="identity" @close="selected = null" />
  </section>
</template>
