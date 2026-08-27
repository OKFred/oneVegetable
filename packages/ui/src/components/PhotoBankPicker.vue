<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { Check, Eye, ImagePlus, Upload, X } from '@lucide/vue';

import type { Photo, PhotoGroup } from '@one-vegetable/core';

import QueryState from './QueryState.vue';
import ImagePreview, { type ImagePreviewItem } from './ImagePreview.vue';
import PhotoGroupNavigation from './PhotoGroupNavigation.vue';
import PhotoUploadDialog from './PhotoUploadDialog.vue';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import { useServices } from '../lib/services';

const props = withDefaults(
  defineProps<{
    modelValue: Photo[];
    max?: number;
    buttonLabel?: string;
  }>(),
  { max: 1, buttonLabel: '从图库选择' }
);
const emit = defineEmits<{ 'update:modelValue': [photos: Photo[]] }>();

const { gateway } = useServices();
const queryClient = useQueryClient();
const open = ref(false);
const uploadDialogOpen = ref(false);
const selectedGroup = ref('-1');
const selectedGroupName = ref('全部图片');
const page = ref(1);
const pageSize = 12;
const uploadNotice = ref('');
const observedDimensions = ref<Record<string, { width: number; height: number }>>({});
const previewOpen = ref(false);
const previewIndex = ref(0);
const previewPhotos = ref<Photo[]>([]);
const photos = useQuery({
  queryKey: ['photos', selectedGroup, page],
  queryFn: () =>
    gateway.request('listPhotos', {
      page: page.value,
      pageSize,
      groupId: selectedGroup.value
    }),
  enabled: open
});
const selectedIds = computed(() => new Set(props.modelValue.map((photo) => photo.id)));
const totalPages = computed(() => Math.max(1, Math.ceil((photos.data.value?.total ?? 0) / pageSize)));

watch(open, (value) => {
  if (!value) uploadDialogOpen.value = false;
});

function choose(photo: Photo): void {
  const observed = observedDimensions.value[photo.id];
  const selectedPhoto = observed ? { ...photo, ...observed } : photo;
  const exists = selectedIds.value.has(photo.id);
  if (exists) {
    emit(
      'update:modelValue',
      props.modelValue.filter((item) => item.id !== photo.id)
    );
    return;
  }
  if (props.max === 1) {
    emit('update:modelValue', [selectedPhoto]);
    return;
  }
  if (props.modelValue.length < props.max) {
    emit('update:modelValue', [...props.modelValue, selectedPhoto]);
  }
}

function changeGroup(groupId: string): void {
  selectedGroup.value = groupId;
  page.value = 1;
}

function selectGroup(group: PhotoGroup): void {
  selectedGroupName.value = group.name;
}

function openUploadDialog(): void {
  uploadNotice.value = '';
  uploadDialogOpen.value = true;
}

async function handleUploaded(photo: Photo): Promise<void> {
  page.value = 1;
  uploadNotice.value = `“${photo.name}”已存入图库，请在素材列表中选择。`;
  await queryClient.invalidateQueries({ queryKey: ['photos'] });
}

function rememberDimensions(photo: Photo, event: Event): void {
  if (!(event.target instanceof HTMLImageElement)) return;
  if (event.target.naturalWidth < 1 || event.target.naturalHeight < 1) return;
  observedDimensions.value = {
    ...observedDimensions.value,
    [photo.id]: { width: event.target.naturalWidth, height: event.target.naturalHeight }
  };
}

function dimensionsLabel(photo: Photo): string {
  const observed = observedDimensions.value[photo.id];
  const width = photo.width ?? observed?.width;
  const height = photo.height ?? observed?.height;
  return width && height ? `${width}×${height}` : '尺寸读取中';
}

function photoPreviewUrl(photo: Photo): string {
  return photo.previewUrl ?? photo.url;
}

const previewImages = computed<ImagePreviewItem[]>(() =>
  previewPhotos.value.map((photo) => ({
    id: photo.id,
    src: photoPreviewUrl(photo),
    alt: photo.name,
    description: `${dimensionsLabel(photo)} · ${Math.ceil(photo.fileSize / 1024)} KiB`
  }))
);

function showPreview(collection: readonly Photo[], photo: Photo): void {
  previewPhotos.value = [...collection];
  previewIndex.value = Math.max(
    0,
    collection.findIndex((candidate) => candidate.id === photo.id)
  );
  previewOpen.value = true;
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="modelValue.length" data-testid="selected-photo-strip" class="flex gap-2 overflow-auto pb-1">
      <div
        v-for="photo in modelValue"
        :key="photo.id"
        class="group relative aspect-square w-24 shrink-0 overflow-hidden rounded-md border"
      >
        <button
          type="button"
          class="block w-full"
          :aria-label="`预览 ${photo.name}`"
          @click="showPreview(modelValue, photo)"
        >
          <img
            :src="photoPreviewUrl(photo)"
            :alt="photo.name"
            class="size-full bg-muted object-cover"
            @load="rememberDimensions(photo, $event)"
          />
        </button>
        <button
          type="button"
          class="absolute right-1 top-1 rounded-full bg-background/90 p-1 opacity-0 shadow group-hover:opacity-100"
          :aria-label="`移除 ${photo.name}`"
          @click="choose(photo)"
        >
          <X class="size-3" />
        </button>
      </div>
    </div>
    <Button variant="outline" size="sm" @click="open = true">
      <ImagePlus class="size-4" />{{ buttonLabel }}
      <Badge variant="secondary">{{ modelValue.length }}/{{ max }}</Badge>
    </Button>

    <Teleport to="body">
      <Transition name="ov-modal">
        <div
          v-if="open"
          class="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"
          @click.self="open = false"
        >
          <Card class="ov-modal-panel flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden">
            <header class="flex items-center justify-between border-b p-4">
              <div>
                <h2 class="font-semibold">选择图库素材</h2>
                <p class="mt-1 text-xs text-muted-foreground">
                  仅点击素材才会选入商品；已选 {{ modelValue.length }}/{{ max }}。
                </p>
              </div>
              <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" @click="openUploadDialog">
                  <Upload class="size-4" />上传新素材
                </Button>
                <Button variant="ghost" size="icon" aria-label="关闭图库" @click="open = false"
                  ><X class="size-4"
                /></Button>
              </div>
            </header>
            <div class="grid min-h-0 flex-1 md:grid-cols-[220px_1fr]">
              <aside class="overflow-auto border-r p-3">
                <PhotoGroupNavigation
                  :model-value="selectedGroup"
                  @update:model-value="changeGroup"
                  @select="selectGroup"
                />
                <div class="mt-4 rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
                  <p class="font-medium text-foreground">当前分组：{{ selectedGroupName }}</p>
                  <p class="mt-1">此处只负责选择已有素材；上传新素材是独立操作。</p>
                </div>
              </aside>
              <main class="min-h-0 overflow-auto p-4">
                <p
                  v-if="uploadNotice"
                  class="mb-3 rounded-md border p-3 text-xs text-emerald-700"
                  role="status"
                >
                  {{ uploadNotice }}
                </p>
                <QueryState :loading="photos.isPending.value" :error="photos.error.value">
                  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    <div
                      v-for="photo in photos.data.value?.items ?? []"
                      :key="photo.id"
                      class="group relative overflow-hidden rounded-lg border text-left hover:border-primary"
                      :class="selectedIds.has(photo.id) ? 'ring-2 ring-primary' : ''"
                    >
                      <button
                        type="button"
                        class="block w-full text-left"
                        :aria-label="`${selectedIds.has(photo.id) ? '取消选择' : '选择'} ${photo.name}`"
                        @click="choose(photo)"
                      >
                        <img
                          :src="photoPreviewUrl(photo)"
                          :alt="photo.name"
                          class="aspect-square w-full bg-muted object-cover"
                          @load="rememberDimensions(photo, $event)"
                        />
                        <span class="block p-2">
                          <span class="block truncate text-sm font-medium">{{ photo.name }}</span>
                          <span class="text-xs text-muted-foreground"
                            >{{ dimensionsLabel(photo) }} · {{ Math.ceil(photo.fileSize / 1024) }} KiB</span
                          >
                        </span>
                      </button>
                      <button
                        type="button"
                        class="absolute left-2 top-2 rounded-full bg-background/90 p-1.5 opacity-0 shadow transition-opacity hover:bg-background group-hover:opacity-100 focus-visible:opacity-100"
                        :aria-label="`预览 ${photo.name}`"
                        @click="showPreview(photos.data.value?.items ?? [], photo)"
                      >
                        <Eye class="size-4" />
                      </button>
                      <span
                        v-if="selectedIds.has(photo.id)"
                        class="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"
                        ><Check class="size-3"
                      /></span>
                    </div>
                  </div>
                </QueryState>
              </main>
            </div>
            <footer class="flex items-center justify-between border-t p-4">
              <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" :disabled="page <= 1" @click="page--">上一页</Button>
                <span class="text-xs text-muted-foreground">{{ page }}/{{ totalPages }}</span>
                <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="page++"
                  >下一页</Button
                >
              </div>
              <Button @click="open = false">完成选择</Button>
            </footer>
          </Card>
        </div>
      </Transition>
    </Teleport>

    <PhotoUploadDialog
      v-model:open="uploadDialogOpen"
      :group-id="selectedGroup"
      :group-name="selectedGroupName"
      @uploaded="handleUploaded"
    />

    <ImagePreview v-model:open="previewOpen" :images="previewImages" :initial-index="previewIndex" />
  </div>
</template>
