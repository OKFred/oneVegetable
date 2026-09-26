<script setup lang="ts">
import { computed, defineAsyncComponent, h, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { Film, Search, Info, Upload } from '@lucide/vue';
import { safeVideoId, type Video, type VideoPage } from '@one-vegetable/core/video';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { pageDetailIdentity } from '../lib/page-details';
import { requestVideo, VideoReadScope, type VideoProductTarget } from '../lib/video-library';
import { useVideoI18n } from '../i18n/video';
import { useUiI18n } from '../i18n';
import { visibleVideoIssues } from '../lib/video-diagnostics';
import { formatDateTime } from '../lib/date-time';
import type { DataColumn } from '../lib/table';
import Button from '../components/ui/Button.vue';
import Input from '../components/ui/Input.vue';
import DataTable from '../components/DataTable.vue';
import TablePagination from '../components/TablePagination.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import VideoDrawer from '../components/VideoDrawer.vue';
import ListFilterDialog from '../components/ListFilterDialog.vue';
import ListToolbar from '../components/ListToolbar.vue';
import ListActionButton from '../components/ListActionButton.vue';
import ListViewToggle from '../components/ListViewToggle.vue';
import ModalDialog from '../components/ui/ModalDialog.vue';
const VideoUploadDialog = defineAsyncComponent(() => import('../components/VideoUploadDialog.vue'));
const VideoProductAssociationDialog = defineAsyncComponent(
  () => import('../components/VideoProductAssociationDialog.vue')
);
const associationTarget = shallowRef<VideoProductTarget | null>(null);
function associate(video: Video): void {
  if (video.id && identity.value) associationTarget.value = { videoId: video.id, identity: identity.value };
}
const uploadOpen = ref(false);
const { gateway, mode } = useServices();
const { alibabaLanguage } = useAppPreferences();
const vt = useVideoI18n();
const { t } = useUiI18n();
const filterOpen = ref(false),
  diagnosticsOpen = ref(false);
interface Filters {
  id: string;
  status: string;
  quality: string;
  related: 'all' | 'yes' | 'no' | 'unknown';
}
const defaults = (): Filters => ({ id: '', status: '', quality: '', related: 'all' });
const filters = ref(defaults()),
  draft = ref(defaults());
const filterCount = computed(
  () =>
    Number(!!filters.value.id) +
    Number(!!filters.value.status) +
    Number(!!filters.value.quality) +
    Number(filters.value.related !== 'all')
);
const invalidId = computed(() => !!draft.value.id.trim() && !safeVideoId(draft.value.id.trim()));
watch(filterOpen, (open) => {
  if (open) draft.value = { ...filters.value };
});
function applyFilters() {
  if (invalidId.value) return;
  filters.value = { ...draft.value, id: draft.value.id.trim() };
  id.value = filters.value.id;
  filterOpen.value = false;
  search();
}
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
const diagnosticIssues = computed(() => visibleVideoIssues(result.value?.issues ?? []));
const rows = computed(() =>
  (result.value?.items ?? []).filter(
    (video) =>
      (!filters.value.status || video.status === filters.value.status) &&
      (!filters.value.quality || video.quality === filters.value.quality) &&
      (filters.value.related === 'all' ||
        (filters.value.related === 'unknown'
          ? video.relatedProductCount === null
          : filters.value.related === 'yes'
            ? video.relatedProductCount !== null && video.relatedProductCount > 0
            : video.relatedProductCount === 0))
  )
);
const statuses = computed(() => [
  ...new Set((result.value?.items ?? []).flatMap((v) => (v.status ? [v.status] : [])))
]);
const qualities = computed(() => [
  ...new Set((result.value?.items ?? []).flatMap((v) => (v.quality ? [v.quality] : [])))
]);
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
    if (current()) {
      result.value = data;
    }
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
  void load(true);
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
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': `${vt('view')}: ${row.original.title ?? row.original.id ?? '—'}`,
              onClick: () => {
                selected.value = row.original;
              }
            },
            [
              h('img', {
                src: row.original.coverUrl,
                alt: '',
                loading: 'lazy',
                referrerpolicy: 'no-referrer',
                class: 'h-16 w-24 rounded object-contain'
              })
            ]
          )
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
      h('div', { class: 'flex gap-2' }, [
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
        ),
        h(
          Button,
          {
            variant: 'outline',
            disabled: !row.original.id,
            onClick: () => {
              associate(row.original);
            }
          },
          () => vt('useInProduct')
        )
      ]),
    meta: { sticky: 'right', stickyOffset: '0px', stickyBoundary: true, width: '96px' }
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
  <section data-testid="video-library">
    <h2 class="mb-3 text-xl font-semibold">{{ vt('title') }}</h2>
    <ListToolbar data-testid="video-toolbar" @search="search">
      <template #search>
        <Input
          v-model="title"
          :aria-label="vt('titleSearch')"
          :placeholder="vt('titleSearch')"
          class="min-w-0 flex-1"
          maxlength="200"
          @keydown.enter.prevent="search"
        />
        <ListActionButton :icon="Search" type="submit" :disabled="busy">{{ vt('search') }}</ListActionButton>
      </template>
      <template #actions>
        <ListFilterDialog
          v-model:open="filterOpen"
          :active-count="filterCount"
          :invalid="invalidId"
          @apply="applyFilters"
          @reset="draft = defaults()"
        >
          <fieldset class="space-y-3">
            <legend class="font-medium">{{ t('common.filters.server') }}</legend>
            <label class="grid gap-1 text-sm"
              >{{ vt('idSearch') }}<Input v-model="draft.id" inputmode="numeric"
            /></label>
            <p v-if="invalidId" class="text-sm text-destructive">{{ vt('idInvalid') }}</p>
          </fieldset>
          <fieldset class="space-y-3">
            <legend class="font-medium">{{ t('common.filters.page') }}</legend>
            <p class="text-xs text-muted-foreground">{{ t('common.filters.pageHint') }}</p>
            <label class="grid gap-1 text-sm"
              >{{ vt('status')
              }}<select v-model="draft.status" class="rounded-md border bg-background p-2">
                <option value="">{{ vt('all') }}</option>
                <option v-for="value in statuses" :key="value" :value="value">{{ value }}</option>
              </select></label
            >
            <label class="grid gap-1 text-sm"
              >{{ vt('quality')
              }}<select v-model="draft.quality" class="rounded-md border bg-background p-2">
                <option value="">{{ vt('all') }}</option>
                <option v-for="value in qualities" :key="value" :value="value">{{ value }}</option>
              </select></label
            >
            <label class="grid gap-1 text-sm"
              >{{ vt('relations')
              }}<select v-model="draft.related" class="rounded-md border bg-background p-2">
                <option value="all">{{ vt('all') }}</option>
                <option value="yes">{{ vt('withRelations') }}</option>
                <option value="no">{{ vt('withoutRelations') }}</option>
                <option value="unknown">{{ vt('relationUnknown') }}</option>
              </select></label
            >
          </fieldset>
        </ListFilterDialog>
        <ListActionButton :icon="Upload" @click="uploadOpen = true">{{ vt('upload') }}</ListActionButton>
        <Button
          v-if="diagnosticIssues.length"
          variant="ghost"
          size="icon"
          :aria-label="vt('issues')"
          @click="diagnosticsOpen = true"
          ><Info class="size-4"
        /></Button>
        <ListViewToggle
          v-model="view"
          :label="t('photos.governance.displayMode')"
          :cards-label="vt('cards')"
          :list-label="vt('list')"
        />
      </template>
    </ListToolbar>
    <ErrorNotice v-if="error" :error="error" />
    <p v-if="busy" role="status">{{ vt('loading') }}</p>
    <ModalDialog v-model:open="diagnosticsOpen" :title="vt('issues')"
      ><ul class="space-y-2 break-all font-mono text-xs">
        <li v-for="issue in diagnosticIssues" :key="issue">{{ issue }}</li>
      </ul></ModalDialog
    >
    <template v-if="view === 'cards'">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article
          v-for="(video, index) in rows"
          :key="video.encryptedId ?? index"
          class="overflow-hidden rounded-lg border bg-card text-left transition hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
        >
          <button
            type="button"
            class="block w-full text-left focus-visible:ring-2 focus-visible:ring-ring"
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
          <div class="px-3 pb-3">
            <Button variant="outline" size="sm" :disabled="!video.id" @click="associate(video)">{{
              vt('useInProduct')
            }}</Button>
          </div>
        </article>
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
      :selection-scope="JSON.stringify([page, pageSize, submitted, filters, alibabaLanguage, identity])"
      :empty-text="vt('empty')"
      column-settings-key="videos"
      :locked-columns="['actions']"
      :hidden-columns="['durationRaw', 'width', 'height', 'publisher', 'encryptedId']"
      :get-row-key="(video) => video.encryptedId ?? video.id ?? ''"
      :active-row-key="selected?.encryptedId"
    />
    <TablePagination
      v-if="result"
      :page="page"
      :page-size="pageSize"
      :total="result.total"
      :has-next-page="
        result.total === null ? result.items.length === pageSize : page * pageSize < result.total
      "
      :page-size-options="[20, 50]"
      :disabled="busy"
      @update:page="setPage"
      @update:page-size="setSize"
    />
    <VideoDrawer :video="selected" :identity="identity" @close="selected = null" />
    <VideoUploadDialog
      v-if="uploadOpen"
      v-model:open="uploadOpen"
      @confirmed="load(true)"
      @associate="associationTarget = $event"
    />
    <VideoProductAssociationDialog
      v-if="associationTarget"
      :target="associationTarget"
      @close="associationTarget = null"
    />
  </section>
</template>
