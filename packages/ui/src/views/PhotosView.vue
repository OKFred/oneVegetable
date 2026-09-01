<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Eye, LayoutGrid, List as ListIcon, Settings2, Share2, ShieldCheck, Upload } from '@lucide/vue';
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
import GroupSidebar from '../components/GroupSidebar.vue';
import PageHeader from '../components/PageHeader.vue';
import ImagePreview, { type ImagePreviewItem } from '../components/ImagePreview.vue';
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
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

type GovernanceFilter = 'all' | 'unreferenced' | 'lowResolution';
type PhotoViewMode = 'cards' | 'list';

const { gateway } = useServices();
const selectedGroup = ref('-1');
const governanceFilter = ref<GovernanceFilter>('all');
const photoViewMode = ref<PhotoViewMode>('cards');
const selectedGroupDefinition = ref<PhotoGroup | null>(null);
const observedDimensions = ref<Record<string, { width: number; height: number }>>({});
const previewOpen = ref(false);
const previewIndex = ref(0);
const uploadDialogOpen = ref(false);
const shareDialogOpen = ref(false);
const groupManagerOpen = ref(false);
const groupNavigationRevision = ref(0);
const groupSidebarCollapsed = ref(false);
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
    '当前环境未开放图库上传或外部 URL 转存'
  );
});
const selectedGroupName = computed(() => selectedGroupDefinition.value?.name ?? '全部图片');
const photos = useQuery({
  queryKey: ['photos', selectedGroup],
  queryFn: () => gateway.request('listPhotos', { page: 1, pageSize: 24, groupId: selectedGroup.value })
});
const filteredPhotos = computed(() => {
  const items = photos.data.value?.items ?? [];
  if (governanceFilter.value === 'unreferenced') {
    return items.filter((photo) => photo.referenceCount === 0);
  }
  if (governanceFilter.value === 'lowResolution') {
    return items.filter(isLowResolution);
  }
  return items;
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
    description: `${dimensionsLabel(photo)} · ${fileSize(photo.fileSize)}`
  }))
);

watch(selectedGroup, () => {
  selectedPhotoIds.value = [];
});
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
  if (selectedPhotoIds.value.length >= SOCIAL_SHARE_MAX_PHOTOS) {
    toast.warning(`单次最多选择 ${SOCIAL_SHARE_MAX_PHOTOS} 张图片`);
    return;
  }
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
  return value ? `${value.width} × ${value.height}` : '尺寸读取中';
}

function isLowResolution(photo: Photo): boolean {
  const value = dimensions(photo);
  return value !== null && (value.width < 750 || value.height < 750);
}

function fileSize(value: number): string {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`;
}

function modifiedAtLabel(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

function openPreview(photo: Photo): void {
  previewIndex.value = Math.max(
    0,
    filteredPhotos.value.findIndex((candidate) => candidate.id === photo.id)
  );
  previewOpen.value = true;
}

function handleUploaded(photo: Photo): void {
  toast.success(`已上传到图库：${photo.name}`);
}

const photoColumns: DataColumn<Photo>[] = [
  {
    id: 'selection',
    header: '选择',
    cell: ({ row }) => {
      const photo = row.original;
      const selected = selectedPhotoIdSet.value.has(photo.id);
      return h(TriStateCheckbox, {
        checked: selected,
        label: `${selected ? '取消选择' : '选择'} ${photo.name}`,
        'onUpdate:checked': (checked: boolean) => {
          setPhotoSelected(photo.id, checked);
        }
      });
    },
    meta: { sticky: 'left', stickyOffset: '0px', width: '64px' }
  },
  {
    id: 'thumbnail',
    header: '图片',
    cell: ({ row }) => {
      const photo = row.original;
      return h(
        'button',
        {
          type: 'button',
          class:
            'group relative block size-14 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'aria-label': `预览 ${photo.name}`,
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
    meta: { sticky: 'left', stickyOffset: '64px', stickyBoundary: true, width: '88px' }
  },
  {
    id: 'name',
    header: '名称',
    cell: ({ row }) =>
      h('div', { class: 'min-w-56' }, [
        h('p', { class: 'max-w-72 truncate font-medium', title: row.original.name }, row.original.name),
        h('p', { class: 'mt-1 font-mono text-[11px] text-muted-foreground' }, `fileId：${row.original.id}`)
      ])
  },
  {
    id: 'dimensions',
    header: '尺寸',
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
    header: '大小',
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, fileSize(row.original.fileSize))
  },
  {
    id: 'references',
    header: '引用情况',
    cell: ({ row }) => {
      const photo = row.original;
      return h('div', { class: 'flex min-w-32 flex-wrap gap-1' }, [
        h(Badge, { variant: 'secondary' }, () => `引用 ${photo.referenceCount}`),
        photo.referenceCount === 0 ? h(Badge, { variant: 'outline' }, () => '建议清理') : null,
        isLowResolution(photo) ? h(Badge, { variant: 'outline' }, () => '建议换高清图') : null
      ]);
    }
  },
  {
    id: 'modifiedAt',
    header: '更新时间',
    cell: ({ row }) =>
      h(
        'span',
        { class: 'whitespace-nowrap text-muted-foreground' },
        modifiedAtLabel(row.original.modifiedAt)
      )
  },
  {
    id: 'actions',
    header: '操作',
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          onClick: () => {
            openPreview(row.original);
          }
        },
        () => [h(Eye, { class: 'size-4', 'aria-hidden': 'true' }), '预览']
      ),
    meta: { sticky: 'right', stickyOffset: '0px', stickyBoundary: true, width: '104px' }
  }
];
</script>

<template>
  <PageHeader title="图库" description="管理国际站图库（图片银行）的分组、发品素材与非阻断治理提示。">
    <div class="flex flex-wrap items-center justify-end gap-2">
      <Button variant="outline" @click="groupManagerOpen = true">
        <Settings2 class="size-4" />分组管理
      </Button>
      <Button variant="outline" :disabled="selectedPhotos.length === 0" @click="shareDialogOpen = true">
        <Share2 class="size-4" />{{ selectedPhotos.length > 0 ? `分享 ${selectedPhotos.length} 张` : '分享' }}
      </Button>
      <ActionTooltip :disabled="uploadDialogBlocked" :reason="uploadDialogReason">
        <Button :disabled="uploadDialogBlocked" @click="uploadDialogOpen = true">
          <Upload class="size-4" />上传图片
        </Button>
      </ActionTooltip>
    </div>
  </PageHeader>

  <div class="mb-5 grid gap-3 md:grid-cols-3">
    <Card class="p-4">
      <p class="text-xs text-muted-foreground">当前页素材</p>
      <p class="mt-1 text-2xl font-semibold">{{ photos.data.value?.items.length ?? 0 }}</p>
    </Card>
    <Card class="p-4">
      <p class="text-xs text-muted-foreground">未被商品引用</p>
      <p class="mt-1 text-2xl font-semibold">{{ governanceCounts.unreferenced }}</p>
    </Card>
    <Card class="p-4">
      <p class="text-xs text-muted-foreground">低于 750 × 750</p>
      <p class="mt-1 text-2xl font-semibold">{{ governanceCounts.lowResolution }}</p>
    </Card>
  </div>

  <div
    class="grid gap-5 transition-[grid-template-columns] duration-200"
    :class="
      groupSidebarCollapsed ? 'lg:grid-cols-[3.25rem_minmax(0,1fr)]' : 'lg:grid-cols-[270px_minmax(0,1fr)]'
    "
  >
    <GroupSidebar v-model:collapsed="groupSidebarCollapsed" title="图库分组">
      <PhotoGroupNavigation
        :key="groupNavigationRevision"
        v-model="selectedGroup"
        @select="selectGroupDefinition"
      />
    </GroupSidebar>

    <section class="space-y-3">
      <Card class="flex flex-wrap items-center justify-between gap-3 p-3">
        <div class="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span class="inline-flex items-center gap-2"><ShieldCheck class="size-4" />素材治理</span>
          <Badge variant="secondary">建议不阻断使用</Badge>
          <Badge v-if="selectedPhotos.length > 0" variant="outline"
            >已选 {{ selectedPhotos.length }} 张</Badge
          >
          <Button v-if="selectedPhotos.length > 0" variant="ghost" size="sm" @click="selectedPhotoIds = []">
            取消选择
          </Button>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            :variant="governanceFilter === 'all' ? 'secondary' : 'outline'"
            @click="governanceFilter = 'all'"
          >
            全部
          </Button>
          <Button
            size="sm"
            :variant="governanceFilter === 'unreferenced' ? 'secondary' : 'outline'"
            @click="governanceFilter = 'unreferenced'"
          >
            未引用 {{ governanceCounts.unreferenced }}
          </Button>
          <Button
            size="sm"
            :variant="governanceFilter === 'lowResolution' ? 'secondary' : 'outline'"
            @click="governanceFilter = 'lowResolution'"
          >
            低分辨率 {{ governanceCounts.lowResolution }}
          </Button>
          <div
            class="inline-flex items-center rounded-md border bg-background p-0.5"
            role="group"
            aria-label="图库展示方式"
          >
            <Button
              size="sm"
              :variant="photoViewMode === 'cards' ? 'secondary' : 'ghost'"
              class="h-8 gap-1.5 px-2.5"
              :aria-pressed="photoViewMode === 'cards'"
              @click="photoViewMode = 'cards'"
            >
              <LayoutGrid class="size-4" aria-hidden="true" />卡片
            </Button>
            <Button
              size="sm"
              :variant="photoViewMode === 'list' ? 'secondary' : 'ghost'"
              class="h-8 gap-1.5 px-2.5"
              :aria-pressed="photoViewMode === 'list'"
              @click="photoViewMode = 'list'"
            >
              <ListIcon class="size-4" aria-hidden="true" />列表
            </Button>
          </div>
        </div>
      </Card>

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
            <span class="absolute left-3 top-3 z-20 rounded-md bg-background/90 p-1 shadow backdrop-blur">
              <TriStateCheckbox
                :checked="selectedPhotoIdSet.has(photo.id)"
                :label="`${selectedPhotoIdSet.has(photo.id) ? '取消选择' : '选择'} ${photo.name}`"
                @update:checked="setPhotoSelected(photo.id, $event)"
              />
            </span>
            <button
              type="button"
              class="group relative block w-full overflow-hidden bg-muted text-left"
              :aria-label="`预览 ${photo.name}`"
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
                <Badge variant="secondary">引用 {{ photo.referenceCount }}</Badge>
                <Badge v-if="photo.referenceCount === 0" variant="outline">建议清理</Badge>
                <Badge v-if="isLowResolution(photo)" variant="outline">建议换高清图</Badge>
              </div>
              <p class="text-[11px] text-muted-foreground">图库 fileId：{{ photo.id }}</p>
              <p class="text-[11px] text-muted-foreground">
                更新于 {{ new Date(photo.modifiedAt).toLocaleDateString('zh-CN') }}
              </p>
            </div>
          </Card>
        </div>
        <div v-else-if="filteredPhotos.length > 0" data-testid="photo-list-table">
          <DataTable
            :columns="photoColumns"
            :data="filteredPhotos"
            :pagination="false"
            min-width="980px"
            max-height="min(64vh, 680px)"
            :get-row-key="(photo) => photo.id"
            :row-aria-label="(photo) => `预览 ${photo.name}`"
            @row-activate="openPreview"
          />
        </div>
        <Card v-if="filteredPhotos.length === 0" class="p-8 text-center text-sm text-muted-foreground">
          <p>当前筛选下没有素材。</p>
          <div class="mt-3 flex justify-center gap-2">
            <Button
              v-if="governanceFilter !== 'all'"
              variant="outline"
              size="sm"
              @click="governanceFilter = 'all'"
              >清除筛选</Button
            >
            <Button v-else size="sm" :disabled="uploadDialogBlocked" @click="uploadDialogOpen = true">
              上传图片
            </Button>
          </div>
        </Card>
      </QueryState>
    </section>
  </div>

  <PhotoGroupManagerDialog v-model:open="groupManagerOpen" @changed="handleGroupChanged" />

  <PhotoSocialShareDialog v-model:open="shareDialogOpen" :photos="selectedPhotos" />

  <PhotoUploadDialog
    v-model:open="uploadDialogOpen"
    :group-id="selectedGroup"
    :group-name="selectedGroupName"
    @uploaded="handleUploaded"
  />

  <ImagePreview v-model:open="previewOpen" :images="previewImages" :initial-index="previewIndex" />
</template>
