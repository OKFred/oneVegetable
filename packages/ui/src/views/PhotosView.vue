<script setup lang="ts">
import { computed, h, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { Download, Eye, FileInput, Layers3, ClipboardList, Share2, Search, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';

import type {
  Photo,
  PhotoGroup,
  PhotoGroupOperationRequest,
  PhotoGroupOperationResult
} from '@one-vegetable/core';
import { SOCIAL_SHARE_MAX_PHOTOS } from '@one-vegetable/core';

import ActionTooltip from '../components/ActionTooltip.vue';
import DataTable from '../components/DataTable.vue';
import TablePagination from '../components/TablePagination.vue';
import ListFilterDialog from '../components/ListFilterDialog.vue';
import ListToolbar from '../components/ListToolbar.vue';
import ListActionButton from '../components/ListActionButton.vue';
import ListViewToggle from '../components/ListViewToggle.vue';
import Input from '../components/ui/Input.vue';
import { fieldColumn, photoExtraFields } from '../lib/field-columns';
import GroupSidebar from '../components/GroupSidebar.vue';
import PageHeader from '../components/PageHeader.vue';
import ImagePreview, { type ImagePreviewItem } from '../components/ImagePreview.vue';
import GalleryTransferDialog from '../components/GalleryTransferDialog.vue';
import { useGalleryTransfers } from '../lib/gallery-transfer-service';
const galleryTransfers = useGalleryTransfers();
import PhotoGroupManagerDialog from '../components/PhotoGroupManagerDialog.vue';
import PhotoGroupNavigation from '../components/PhotoGroupNavigation.vue';
import PhotoSocialShareDialog from '../components/PhotoSocialShareDialog.vue';
import PhotoUploadDialog from '../components/PhotoUploadDialog.vue';
import QueryState from '../components/QueryState.vue';
import TriStateCheckbox from '../components/TriStateCheckbox.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import {
  operationAvailabilityMessage,
  useOperationAvailability
} from '../composables/use-operation-availability';
import { formatDate, formatDateTime } from '../lib/date-time';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import type { DataColumn } from '../lib/table';

type PhotoViewMode = 'cards' | 'list';
interface PhotoFilters {
  group: 'all' | 'selected' | 'ungrouped';
  reference: 'all' | 'referenced' | 'unreferenced';
  dimensions: 'all' | 'lowResolution' | 'unknown';
  minimumSize: string;
  maximumSize: string;
}
const defaultFilters = (): PhotoFilters => ({
  group: 'selected',
  reference: 'all',
  dimensions: 'all',
  minimumSize: '',
  maximumSize: ''
});

const { gateway } = useServices();
const identityScope = useListIdentityScope();
const queryClient = useQueryClient();
const groupCacheRevision = ref(0);
onScopeDispose(
  queryClient.getQueryCache().subscribe((event) => {
    const key: unknown = event.query.queryKey;
    if (Array.isArray(key) && (key as unknown[])[0] === 'photo-groups') groupCacheRevision.value++;
  })
);
function groupPath(id: string): string {
  if (id === '-1') return t('photos.filters.ungrouped');
  void groupCacheRevision.value;
  const groups = queryClient
    .getQueriesData<PhotoGroup[]>({ queryKey: ['photo-groups'] })
    .flatMap(([, data]) => data ?? []);
  const names: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const group = groups.find((item) => item.id === current);
    names.unshift(group?.name ?? current);
    current = group?.parentId ?? null;
  }
  return names.join(' / ');
}
const { t } = useUiI18n();
const selectedGroup = ref('-1');
const page = ref(1),
  pageSize = ref(24);
const searchText = ref(''),
  submittedSearch = ref('');
const filterOpen = ref(false),
  filters = ref(defaultFilters()),
  filterDraft = ref(defaultFilters());
const filterCount = computed(
  () =>
    Number(filters.value.group !== 'selected') +
    Number(filters.value.reference !== 'all') +
    Number(filters.value.dimensions !== 'all') +
    Number(!!filters.value.minimumSize || !!filters.value.maximumSize)
);
const invalidSize = computed(() => {
  const { minimumSize, maximumSize } = filterDraft.value;
  return (
    [minimumSize, maximumSize].some((v) => !!v && (!Number.isFinite(Number(v)) || Number(v) < 0)) ||
    (!!minimumSize && !!maximumSize && Number(minimumSize) > Number(maximumSize))
  );
});
watch(filterOpen, (open) => {
  if (open) filterDraft.value = { ...filters.value };
});
function applyFilters() {
  if (invalidSize.value) return;
  filters.value = { ...filterDraft.value };
  page.value = 1;
  selectedPhotoIds.value = [];
  filterOpen.value = false;
}
async function search() {
  if (refreshPending.value) return;
  submittedSearch.value = searchText.value.trim();
  page.value = 1;
  selectedPhotoIds.value = [];
  // Let the query key follow the submitted page/filter before forcing a fresh read.
  await nextTick();
  await refreshGallery();
}
const photoViewMode = ref<PhotoViewMode>('cards');
const selectedGroupDefinition = ref<PhotoGroup | null>(null);
const observedDimensions = ref<Record<string, { width: number; height: number }>>({});
const previewOpen = ref(false);
const previewIndex = ref(0);
const uploadDialogOpen = ref(false);
const shareDialogOpen = ref(false);
const groupManagerOpen = ref(false);
const galleryTransferMode = ref<'import' | 'export'>('export');
const galleryTransferOpen = ref(false);
const groupNavigationRevision = ref(0);
const groupSidebarCollapsed = ref(false);
const groupNavigation = ref<{ refresh: () => Promise<void> } | null>(null);
const refreshPending = ref(false);
const selectedPhotoIds = ref<string[]>([]);
const photoMutations = useOperationAvailability(['uploadPhoto', 'transferPhotoFromUrl']);
const uploadDialogBlocked = computed(
  () => !photoMutations.isAllowed('uploadPhoto') && !photoMutations.isAllowed('transferPhotoFromUrl')
);
const uploadDialogReason = computed(() => {
  if (!uploadDialogBlocked.value) return '';
  return operationAvailabilityMessage(
    [photoMutations.reasonCode('uploadPhoto'), photoMutations.reasonCode('transferPhotoFromUrl')]
      .filter(Boolean)
      .join(', '),
    t('photos.errors.uploadUnavailable')
  );
});
const selectedGroupName = computed(() => selectedGroupDefinition.value?.name ?? t('photos.allPhotos'));
const photos = useQuery({
  queryKey: ['photos', identityScope, selectedGroup, page, pageSize, computed(() => filters.value.group)],
  queryFn: () =>
    gateway.request('listPhotos', {
      page: page.value,
      pageSize: pageSize.value,
      groupId: filters.value.group === 'selected' ? selectedGroup.value : '-1',
      ...(filters.value.group === 'ungrouped' ? { ungrouped: true } : {})
    })
});
const refreshing = computed(() => refreshPending.value || photos.isFetching.value);

async function refreshGallery(): Promise<void> {
  if (refreshPending.value) return;
  refreshPending.value = true;
  try {
    await queryClient.invalidateQueries({ queryKey: ['photo-groups'], refetchType: 'none' });
    await Promise.all([
      photos.refetch({ cancelRefetch: false }),
      groupNavigation.value
        ? groupNavigation.value.refresh()
        : queryClient
            .fetchQuery({
              queryKey: ['photo-groups', 'root'],
              queryFn: () => gateway.request('listPhotoGroups', undefined),
              staleTime: 0
            })
            .catch(() => {
              toast.error(t('photos.groupNavigation.loadFailed'));
            })
    ]);
  } finally {
    refreshPending.value = false;
  }
}
const filteredPhotos = computed(() => {
  const needle = submittedSearch.value.toLocaleLowerCase();
  const { reference, dimensions: dimensionFilter, minimumSize, maximumSize } = filters.value;
  return (photos.data.value?.items ?? []).filter(
    (photo) =>
      (!needle || `${photo.name} ${photo.id}`.toLocaleLowerCase().includes(needle)) &&
      (reference === 'all' ||
        (reference === 'unreferenced' ? photo.referenceCount === 0 : photo.referenceCount > 0)) &&
      (dimensionFilter === 'all' ||
        (dimensionFilter === 'unknown' ? !dimensions(photo) : isLowResolution(photo))) &&
      (!minimumSize || photo.fileSize >= Number(minimumSize) * 1024) &&
      (!maximumSize || photo.fileSize <= Number(maximumSize) * 1024)
  );
});
const selectedPhotoIdSet = computed(() => new Set(selectedPhotoIds.value));
const selectedPhotos = computed(() => {
  const selected = selectedPhotoIdSet.value;
  return (photos.data.value?.items ?? []).filter((photo) => selected.has(photo.id));
});
const governanceCounts = computed(() => {
  const items = photos.data.value?.items ?? [];
  return {
    unreferenced: items.filter((photo) => photo.referenceCount === 0).length,
    lowResolution: items.filter(isLowResolution).length
  };
});
const previewImages = computed<ImagePreviewItem[]>(() =>
  filteredPhotos.value.map((photo) => ({
    id: photo.id,
    src: photo.previewUrl ?? photo.url,
    alt: photo.name,
    description: `${dimensionsLabel(photo)} · ${fileSize(photo.fileSize)}`,
    originalUrl: photo.url,
    information: [
      { label: 'fileId', value: photo.id },
      { label: t('photos.columns.name'), value: photo.name },
      { label: t('photos.columns.dimensions'), value: dimensionsLabel(photo) },
      { label: t('photos.columns.size'), value: fileSize(photo.fileSize) },
      { label: t('photos.columns.references'), value: photo.referenceCount },
      { label: t('photos.groups'), value: groupPath(photo.groupId) },
      { label: t('photos.columns.updated'), value: formatDateTime(photo.modifiedAt) }
    ]
  }))
);

watch(selectedGroup, () => {
  page.value = 1;
  filters.value = { ...filters.value, group: 'selected' };
  selectedPhotoIds.value = [];
});
watch([page, pageSize, identityScope], () => {
  selectedPhotoIds.value = [];
  previewOpen.value = false;
});
watch(pageSize, () => {
  page.value = 1;
});
const allSelected = computed(
  () =>
    filteredPhotos.value.length > 0 &&
    filteredPhotos.value.every((photo) => selectedPhotoIdSet.value.has(photo.id))
);
const someSelected = computed(() =>
  filteredPhotos.value.some((photo) => selectedPhotoIdSet.value.has(photo.id))
);
function selectPage(checked: boolean) {
  selectedPhotoIds.value = checked ? filteredPhotos.value.map((photo) => photo.id) : [];
}
watch(
  () => (photos.data.value?.items ?? []).map((photo) => photo.id).join('|'),
  () => {
    const available = new Set((photos.data.value?.items ?? []).map((photo) => photo.id));
    selectedPhotoIds.value = selectedPhotoIds.value.filter((id) => available.has(id));
  }
);

function setPhotoSelected(photoId: string, checked: boolean): void {
  if (!checked) {
    selectedPhotoIds.value = selectedPhotoIds.value.filter((id) => id !== photoId);
    return;
  }
  if (selectedPhotoIdSet.value.has(photoId)) return;
  selectedPhotoIds.value = [...selectedPhotoIds.value, photoId];
}
function selectGroupDefinition(group: PhotoGroup): void {
  selectedGroupDefinition.value = group.id === '-1' ? null : group;
}

function handleGroupChanged(request: PhotoGroupOperationRequest, result: PhotoGroupOperationResult): void {
  groupNavigationRevision.value += 1;
  if (request.operation === 'delete') {
    selectedGroup.value = '-1';
    selectedGroupDefinition.value = null;
    return;
  }
  if (request.operation === 'rename' && result.group?.id === selectedGroup.value) {
    selectedGroupDefinition.value = result.group;
  }
}

function rememberDimensions(photo: Photo, event: Event): void {
  if (!(event.target instanceof HTMLImageElement)) return;
  if (event.target.naturalWidth < 1 || event.target.naturalHeight < 1) return;
  observedDimensions.value = {
    ...observedDimensions.value,
    [photo.id]: { width: event.target.naturalWidth, height: event.target.naturalHeight }
  };
}

function dimensions(photo: Photo): { width: number; height: number } | null {
  if (photo.width !== null && photo.height !== null) {
    return { width: photo.width, height: photo.height };
  }
  return observedDimensions.value[photo.id] ?? null;
}

function dimensionsLabel(photo: Photo): string {
  const value = dimensions(photo);
  return value ? `${value.width} × ${value.height}` : t('photos.dimensionsLoading');
}

function isLowResolution(photo: Photo): boolean {
  const value = dimensions(photo);
  return value !== null && (value.width < 750 || value.height < 750);
}

function fileSize(value: number): string {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`;
}

function openPreview(photo: Photo): void {
  previewIndex.value = Math.max(
    0,
    filteredPhotos.value.findIndex((candidate) => candidate.id === photo.id)
  );
  previewOpen.value = true;
}

function handleUploaded(photo: Photo): void {
  toast.success(t('photos.feedback.uploaded', { name: photo.name }));
}

function openGalleryTransfer(mode: 'import' | 'export'): void {
  galleryTransferMode.value = mode;
  galleryTransferOpen.value = true;
}

function handleGalleryImported(): void {
  selectedPhotoIds.value = [];
  void photos.refetch();
}

function handleImportedGroupsChanged(): void {
  void queryClient.invalidateQueries({ queryKey: ['photo-groups'] });
  groupNavigationRevision.value += 1;
}
watch(
  () =>
    galleryTransfers?.tasks.value
      .filter((task) => task.direction === 'import')
      .map((task) => `${task.id}:${task.items.filter((item) => item.status === 'confirmed').length}`)
      .join(','),
  () => {
    handleGalleryImported();
    handleImportedGroupsChanged();
  }
);

const photoColumns = computed<DataColumn<Photo>[]>(() => [
  {
    id: 'select',
    header: () =>
      h(TriStateCheckbox, {
        checked: allSelected.value,
        indeterminate: someSelected.value && !allSelected.value,
        disabled: !filteredPhotos.value.length,
        label: t('photos.filters.selectPage'),
        'onUpdate:checked': selectPage
      }),
    cell: ({ row }) => {
      const photo = row.original;
      const selected = selectedPhotoIdSet.value.has(photo.id);
      return h(TriStateCheckbox, {
        checked: selected,
        label: t(selected ? 'photos.deselectPhoto' : 'photos.selectPhoto', { name: photo.name }),
        'onUpdate:checked': (checked: boolean) => {
          setPhotoSelected(photo.id, checked);
        }
      });
    },
    meta: { sticky: 'left', stickyOffset: '0px', width: '64px' }
  },
  {
    id: 'thumbnail',
    header: t('photos.columns.image'),
    cell: ({ row }) => {
      const photo = row.original;
      return h(
        'button',
        {
          type: 'button',
          class:
            'group relative block size-20 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'aria-label': t('photos.previewPhoto', { name: photo.name }),
          onClick: () => {
            openPreview(photo);
          }
        },
        h('img', {
          src: photo.previewUrl ?? photo.url,
          alt: photo.name,
          class: 'size-full object-cover transition-transform duration-200 group-hover:scale-105',
          onLoad: (event: Event) => {
            rememberDimensions(photo, event);
          }
        })
      );
    },
    meta: { width: '112px' }
  },
  {
    id: 'name',
    header: t('photos.columns.name'),
    cell: ({ row }) =>
      h('div', { class: 'min-w-56' }, [
        h('p', { class: 'max-w-72 truncate font-medium', title: row.original.name }, row.original.name),
        h('p', { class: 'mt-1 font-mono text-[11px] text-muted-foreground' }, `fileId：${row.original.id}`)
      ])
  },
  {
    id: 'dimensions',
    header: t('photos.columns.dimensions'),
    cell: ({ row }) =>
      h(
        'span',
        {
          class: isLowResolution(row.original)
            ? 'whitespace-nowrap text-amber-700 dark:text-amber-300'
            : 'whitespace-nowrap'
        },
        dimensionsLabel(row.original)
      )
  },
  {
    id: 'fileSize',
    header: t('photos.columns.size'),
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, fileSize(row.original.fileSize))
  },
  {
    id: 'references',
    header: t('photos.columns.references'),
    cell: ({ row }) => {
      const photo = row.original;
      return h('div', { class: 'flex min-w-32 flex-wrap gap-1' }, [
        h(Badge, { variant: 'secondary' }, () => t('photos.references', { count: photo.referenceCount })),
        photo.referenceCount === 0
          ? h(Badge, { variant: 'outline' }, () => t('photos.cleanupSuggestion'))
          : null,
        isLowResolution(photo)
          ? h(Badge, { variant: 'outline' }, () => t('photos.highResolutionSuggestion'))
          : null
      ]);
    }
  },
  {
    id: 'modifiedAt',
    header: t('photos.columns.updated'),
    cell: ({ row }) =>
      h('span', { class: 'whitespace-nowrap text-muted-foreground' }, formatDateTime(row.original.modifiedAt))
  },
  ...photoExtraFields.map((id) =>
    fieldColumn<Photo>(id, t(`common.fields.${id}`), (row) => row[id], [
      t('common.fields.yes'),
      t('common.fields.no')
    ])
  ),
  fieldColumn<Photo>('groupPath', t('common.fields.groupPath'), (row) => groupPath(row.groupId), [
    t('common.fields.yes'),
    t('common.fields.no')
  ]),
  {
    id: 'actions',
    header: t('photos.columns.actions'),
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: 'ghost',
          onClick: () => {
            openPreview(row.original);
          }
        },
        () => t('photos.preview')
      ),
    meta: { sticky: 'right', stickyOffset: '0px', stickyBoundary: true, width: '104px' }
  }
]);
</script>

<template>
  <PageHeader :title="t('photos.page.title')" :description="t('photos.page.description')" />

  <div class="mb-5 grid gap-3 md:grid-cols-3">
    <Card class="p-4">
      <p class="text-xs text-muted-foreground">{{ t('photos.stats.pageAssets') }}</p>
      <p class="mt-1 text-2xl font-semibold">{{ photos.data.value?.items.length ?? 0 }}</p>
    </Card>
    <Card class="p-4">
      <p class="text-xs text-muted-foreground">{{ t('photos.stats.unreferenced') }}</p>
      <p class="mt-1 text-2xl font-semibold">{{ governanceCounts.unreferenced }}</p>
    </Card>
    <Card class="p-4">
      <p class="text-xs text-muted-foreground">{{ t('photos.stats.lowResolution') }}</p>
      <p class="mt-1 text-2xl font-semibold">{{ governanceCounts.lowResolution }}</p>
    </Card>
  </div>

  <div
    class="grid gap-5 transition-[grid-template-columns] duration-200"
    :class="
      groupSidebarCollapsed ? 'lg:grid-cols-[3.25rem_minmax(0,1fr)]' : 'lg:grid-cols-[270px_minmax(0,1fr)]'
    "
  >
    <GroupSidebar v-model:collapsed="groupSidebarCollapsed" :title="t('photos.groups')">
      <PhotoGroupNavigation
        :key="groupNavigationRevision"
        ref="groupNavigation"
        v-model="selectedGroup"
        @select="selectGroupDefinition"
      />
    </GroupSidebar>

    <section class="min-w-0">
      <ListToolbar data-testid="photo-toolbar" @search="search">
        <template #search>
          <Input
            v-model="searchText"
            class="min-w-0 flex-1"
            :placeholder="t('photos.filters.search')"
            :aria-label="t('photos.filters.search')"
          />
          <ListActionButton :icon="Search" type="submit" :disabled="refreshing" :aria-busy="refreshing">{{
            t('common.filters.search')
          }}</ListActionButton>
        </template>
        <template #actions>
          <TriStateCheckbox
            v-if="photoViewMode === 'cards'"
            class="mr-auto self-center"
            :checked="allSelected"
            :indeterminate="someSelected && !allSelected"
            :disabled="!filteredPhotos.length"
            :label="t('photos.filters.selectPage')"
            @update:checked="selectPage"
          />
          <ListFilterDialog
            v-model:open="filterOpen"
            :active-count="filterCount"
            :invalid="invalidSize"
            @apply="applyFilters"
            @reset="filterDraft = defaultFilters()"
          >
            <fieldset class="space-y-3">
              <legend class="font-medium">{{ t('common.filters.server') }}</legend>
              <label class="grid gap-1 text-sm"
                >{{ t('photos.groups')
                }}<select v-model="filterDraft.group" class="rounded-md border bg-background p-2">
                  <option value="selected">{{ selectedGroupName }}</option>
                  <option value="all">{{ t('photos.allPhotos') }}</option>
                  <option value="ungrouped">{{ t('photos.filters.ungrouped') }}</option>
                </select></label
              >
            </fieldset>
            <fieldset class="mt-5 space-y-3">
              <legend class="font-medium">{{ t('common.filters.page') }}</legend>
              <p class="text-xs text-muted-foreground">{{ t('common.filters.pageHint') }}</p>
              <label class="grid gap-1 text-sm"
                >{{ t('photos.columns.references')
                }}<select v-model="filterDraft.reference" class="rounded-md border bg-background p-2">
                  <option value="all">{{ t('photos.governance.all') }}</option>
                  <option value="unreferenced">{{ t('photos.stats.unreferenced') }}</option>
                  <option value="referenced">{{ t('photos.filters.referenced') }}</option>
                </select></label
              >
              <label class="grid gap-1 text-sm"
                >{{ t('photos.columns.dimensions')
                }}<select
                  v-model="filterDraft.dimensions"
                  data-testid="photo-dimension-filter"
                  class="rounded-md border bg-background p-2"
                >
                  <option value="all">{{ t('photos.governance.all') }}</option>
                  <option value="lowResolution">{{ t('photos.stats.lowResolution') }}</option>
                  <option value="unknown">{{ t('photos.filters.unknownDimensions') }}</option>
                </select></label
              >
              <div class="grid grid-cols-2 gap-3">
                <label class="grid gap-1 text-sm"
                  >{{ t('photos.filters.minimumSize')
                  }}<Input v-model="filterDraft.minimumSize" type="number" min="0" /></label
                ><label class="grid gap-1 text-sm"
                  >{{ t('photos.filters.maximumSize')
                  }}<Input v-model="filterDraft.maximumSize" type="number" min="0"
                /></label>
              </div>
              <p v-if="invalidSize" class="text-sm text-destructive" role="alert">
                {{ t('common.filters.invalidRange') }}
              </p>
            </fieldset>
          </ListFilterDialog>
          <ListActionButton :icon="Layers3" @click="groupManagerOpen = true">
            {{ t('photos.page.groupManagement') }}
          </ListActionButton>
          <ListActionButton :icon="FileInput" @click="openGalleryTransfer('import')">
            {{ t('photos.page.import') }}
          </ListActionButton>
          <ListActionButton v-if="galleryTransfers" :icon="ClipboardList" @click="galleryTransfers.show()">{{
            t('photos.tasks.title')
          }}</ListActionButton>
          <ListActionButton
            :icon="Download"
            :disabled="selectedPhotos.length === 0"
            @click="openGalleryTransfer('export')"
          >
            {{ t('photos.page.export') }}
          </ListActionButton>
          <ListActionButton
            :icon="Share2"
            :disabled="selectedPhotos.length === 0 || selectedPhotos.length > SOCIAL_SHARE_MAX_PHOTOS"
            :title="
              selectedPhotos.length > SOCIAL_SHARE_MAX_PHOTOS
                ? t('photos.errors.maxSelection', { count: SOCIAL_SHARE_MAX_PHOTOS })
                : undefined
            "
            @click="shareDialogOpen = true"
          >
            {{
              selectedPhotos.length > 0
                ? t('photos.page.shareCount', { count: selectedPhotos.length })
                : t('photos.page.share')
            }}
          </ListActionButton>
          <ActionTooltip :disabled="uploadDialogBlocked" :reason="uploadDialogReason">
            <ListActionButton :icon="Upload" :disabled="uploadDialogBlocked" @click="uploadDialogOpen = true">
              {{ t('photos.page.upload') }}
            </ListActionButton>
          </ActionTooltip>
          <ListViewToggle
            v-model="photoViewMode"
            :label="t('photos.governance.displayMode')"
            :cards-label="t('photos.governance.cards')"
            :list-label="t('photos.governance.list')"
          />
        </template>
      </ListToolbar>

      <QueryState
        :loading="photos.isPending.value"
        :error="photos.error.value"
        retryable
        @retry="photos.refetch()"
      >
        <div
          v-if="filteredPhotos.length > 0 && photoViewMode === 'cards'"
          data-testid="photo-card-grid"
          class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        >
          <Card
            v-for="photo in filteredPhotos"
            :key="photo.id"
            class="relative overflow-hidden transition-[box-shadow,border-color]"
            :class="selectedPhotoIdSet.has(photo.id) ? 'ring-2 ring-primary' : ''"
          >
            <span class="absolute left-3 top-3 z-20">
              <TriStateCheckbox
                :checked="selectedPhotoIdSet.has(photo.id)"
                :label="
                  t(selectedPhotoIdSet.has(photo.id) ? 'photos.deselectPhoto' : 'photos.selectPhoto', {
                    name: photo.name
                  })
                "
                variant="overlay"
                @update:checked="setPhotoSelected(photo.id, $event)"
              />
            </span>
            <button
              type="button"
              class="group relative block w-full overflow-hidden bg-muted text-left"
              :aria-label="t('photos.previewPhoto', { name: photo.name })"
              @click="openPreview(photo)"
            >
              <img
                :src="photo.previewUrl ?? photo.url"
                :alt="photo.name"
                class="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                @load="rememberDimensions(photo, $event)"
              />
              <span
                class="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100 group-focus-visible:bg-black/25 group-focus-visible:opacity-100"
              >
                <span class="rounded-full bg-black/55 p-2 backdrop-blur"><Eye class="size-5" /></span>
              </span>
            </button>
            <div class="space-y-2 p-3">
              <p class="truncate text-sm font-medium">{{ photo.name }}</p>
              <p class="text-xs text-muted-foreground">
                {{ dimensionsLabel(photo) }} · {{ fileSize(photo.fileSize) }}
              </p>
              <div class="flex flex-wrap gap-1">
                <Badge variant="secondary">{{
                  t('photos.references', { count: photo.referenceCount })
                }}</Badge>
                <Badge v-if="photo.referenceCount === 0" variant="outline">{{
                  t('photos.cleanupSuggestion')
                }}</Badge>
                <Badge v-if="isLowResolution(photo)" variant="outline">{{
                  t('photos.highResolutionSuggestion')
                }}</Badge>
              </div>
              <p class="text-[11px] text-muted-foreground">
                {{ t('photos.fileId', { id: photo.id }) }}
              </p>
              <p class="text-[11px] text-muted-foreground">
                {{ t('photos.updatedAt', { date: formatDate(photo.modifiedAt) }) }}
              </p>
            </div>
          </Card>
        </div>
        <div v-else-if="photoViewMode === 'list'" data-testid="photo-list-table">
          <DataTable
            :columns="photoColumns"
            column-settings-key="photos"
            :locked-columns="['select', 'actions']"
            :hidden-columns="[...photoExtraFields, 'groupPath']"
            :data="filteredPhotos"
            :empty-text="t('photos.emptyFilter')"
            :pagination="false"
            min-width="980px"
            max-height="min(64vh, 680px)"
            :get-row-key="(photo) => photo.id"
          />
        </div>
        <Card
          v-if="filteredPhotos.length === 0 && photoViewMode === 'cards'"
          class="p-8 text-center text-sm text-muted-foreground"
        >
          <p>{{ t('photos.emptyFilter') }}</p>
          <div class="mt-3 flex justify-center gap-2">
            <Button
              v-if="filterCount || submittedSearch"
              variant="outline"
              size="sm"
              @click="
                filters = defaultFilters();
                searchText = '';
                submittedSearch = '';
                page = 1;
              "
              >{{ t('photos.clearFilter') }}</Button
            >
            <Button v-else size="sm" :disabled="uploadDialogBlocked" @click="uploadDialogOpen = true">
              {{ t('photos.page.upload') }}
            </Button>
          </div>
        </Card>
      </QueryState>
      <div class="border-t px-3 py-2 text-sm text-muted-foreground" aria-live="polite">
        {{ t('photos.governance.selected', { count: selectedPhotos.length }) }}
      </div>
      <TablePagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="photos.data.value?.total ?? null"
        :has-next-page="photos.data.value?.hasNextPage ?? photos.data.value?.items.length === pageSize"
        :page-size-options="[24, 48, 96]"
        :disabled="refreshing"
      />
    </section>
  </div>

  <PhotoGroupManagerDialog v-model:open="groupManagerOpen" @changed="handleGroupChanged" />

  <GalleryTransferDialog
    v-model:open="galleryTransferOpen"
    :mode="galleryTransferMode"
    :photos="selectedPhotos"
    :target-group-id="selectedGroup"
    :target-group-name="selectedGroupName"
    :upload-allowed="photoMutations.isAllowed('uploadPhoto')"
    :upload-disabled-reason="
      operationAvailabilityMessage(
        photoMutations.reasonCode('uploadPhoto'),
        t('photos.errors.uploadUnavailable')
      )
    "
  />

  <PhotoSocialShareDialog v-model:open="shareDialogOpen" :photos="selectedPhotos" />

  <PhotoUploadDialog
    v-model:open="uploadDialogOpen"
    :group-id="selectedGroup"
    :group-name="selectedGroupName"
    @uploaded="handleUploaded"
  />

  <ImagePreview v-model:open="previewOpen" :images="previewImages" :initial-index="previewIndex" />
</template>
