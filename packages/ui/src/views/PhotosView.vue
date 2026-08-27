<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Eye, FolderPlus, Pencil, ShieldCheck, Trash2, Upload } from '@lucide/vue';

import type { Photo, PhotoGroup, PhotoGroupOperationRequest } from '@one-vegetable/core';

import PageHeader from '../components/PageHeader.vue';
import ImagePreview, { type ImagePreviewItem } from '../components/ImagePreview.vue';
import PhotoGroupNavigation from '../components/PhotoGroupNavigation.vue';
import PhotoUploadDialog from '../components/PhotoUploadDialog.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import ModalDialog from '../components/ui/ModalDialog.vue';
import { useServices } from '../lib/services';

type GovernanceFilter = 'all' | 'unreferenced' | 'lowResolution';

const { gateway, mode } = useServices();
const queryClient = useQueryClient();
const selectedGroup = ref('-1');
const groupName = ref('');
const governanceFilter = ref<GovernanceFilter>('all');
const operationMessage = ref('');
const selectedGroupDefinition = ref<PhotoGroup | null>(null);
const observedDimensions = ref<Record<string, { width: number; height: number }>>({});
const previewOpen = ref(false);
const previewIndex = ref(0);
const deleteDialogOpen = ref(false);
const uploadDialogOpen = ref(false);
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
const operateGroup = useMutation({
  mutationFn: (request: PhotoGroupOperationRequest) => gateway.request('operatePhotoGroup', request),
  onSuccess: async (result, request) => {
    operationMessage.value =
      request.operation === 'delete'
        ? '已删除所选分组'
        : `分组已保存：${result.group?.name ?? request.groupName ?? result.groupId}`;
    if (request.operation === 'delete') selectedGroup.value = '-1';
    deleteDialogOpen.value = false;
    groupName.value = '';
    await queryClient.invalidateQueries({ queryKey: ['photo-groups'] });
  },
  onError: (error: Error) => {
    operationMessage.value = error.message;
  }
});

function mutateGroup(operation: PhotoGroupOperationRequest['operation']): void {
  const current = selectedGroupDefinition.value;
  operateGroup.mutate({
    operation,
    groupId:
      operation === 'add' ? (current?.id === '-1' ? null : (current?.id ?? null)) : (current?.id ?? null),
    groupName: operation === 'delete' ? null : groupName.value.trim() || null
  });
}

function selectGroupDefinition(group: PhotoGroup): void {
  selectedGroupDefinition.value = group.id === '-1' ? null : group;
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

function openPreview(photo: Photo): void {
  previewIndex.value = Math.max(
    0,
    filteredPhotos.value.findIndex((candidate) => candidate.id === photo.id)
  );
  previewOpen.value = true;
}

function handleUploaded(photo: Photo): void {
  operationMessage.value = `已上传到图库：${photo.name}`;
}
</script>

<template>
  <PageHeader title="图库" description="管理国际站图库（图片银行）的分组、发品素材与非阻断治理提示。">
    <div class="flex flex-wrap items-center justify-end gap-2">
      <Badge :variant="mode === 'mock' ? 'secondary' : 'success'">
        {{ mode === 'mock' ? 'OpenAPI 演示' : mode === 'bff' ? 'BFF 后端查询' : 'Extension API 查询' }}
      </Badge>
      <Button @click="uploadDialogOpen = true"><Upload class="size-4" />上传图片</Button>
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

  <div class="grid gap-5 lg:grid-cols-[270px_1fr]">
    <Card class="h-fit p-3">
      <p class="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">图库分组</p>
      <PhotoGroupNavigation v-model="selectedGroup" @select="selectGroupDefinition" />

      <div class="mt-3 space-y-2 border-t pt-3">
        <Input v-model="groupName" aria-label="图库分组名称" placeholder="分组名称" />
        <div class="grid grid-cols-3 gap-1">
          <Button
            size="sm"
            variant="outline"
            :disabled="operateGroup.isPending.value || !groupName.trim()"
            title="新增子分组"
            @click="mutateGroup('add')"
            ><FolderPlus class="size-3" />新增</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="operateGroup.isPending.value || selectedGroup === '-1' || !groupName.trim()"
            @click="mutateGroup('rename')"
            ><Pencil class="size-3" />改名</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="operateGroup.isPending.value || selectedGroup === '-1'"
            @click="deleteDialogOpen = true"
            ><Trash2 class="size-3" />删除</Button
          >
        </div>
        <p v-if="mode !== 'mock'" class="text-xs text-emerald-700">
          真实分组新增、改名和删除已完成账号验证；删除前会要求再次确认。
        </p>
        <p v-if="operationMessage" class="text-xs text-muted-foreground">{{ operationMessage }}</p>
      </div>
    </Card>

    <section class="space-y-3">
      <Card class="flex flex-wrap items-center justify-between gap-3 p-3">
        <div class="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck class="size-4" />素材治理
          <Badge variant="secondary">建议不阻断使用</Badge>
        </div>
        <div class="flex flex-wrap gap-2">
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
        </div>
      </Card>

      <QueryState :loading="photos.isPending.value" :error="photos.error.value">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <Card v-for="photo in filteredPhotos" :key="photo.id" class="overflow-hidden">
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
        <Card v-if="filteredPhotos.length === 0" class="p-8 text-center text-sm text-muted-foreground">
          当前筛选下没有素材。
        </Card>
      </QueryState>
    </section>
  </div>

  <ModalDialog
    v-model:open="deleteDialogOpen"
    title="删除图库分组"
    :description="`确定删除“${selectedGroupDefinition?.name ?? '所选分组'}”吗？该请求会直接提交到国际站，平台拒绝时页面会显示错误。`"
    size="sm"
  >
    <p class="text-sm leading-6 text-muted-foreground">
      这是国际站真实写操作。当前分组 ID：{{ selectedGroupDefinition?.id ?? selectedGroup }}。
    </p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="operateGroup.isPending.value" @click="deleteDialogOpen = false">
          取消
        </Button>
        <Button variant="destructive" :disabled="operateGroup.isPending.value" @click="mutateGroup('delete')">
          {{ operateGroup.isPending.value ? '正在删除…' : '确认删除' }}
        </Button>
      </div>
    </template>
  </ModalDialog>

  <PhotoUploadDialog
    v-model:open="uploadDialogOpen"
    :group-id="selectedGroup"
    :group-name="selectedGroupName"
    @uploaded="handleUploaded"
  />

  <ImagePreview v-model:open="previewOpen" :images="previewImages" :initial-index="previewIndex" />
</template>
