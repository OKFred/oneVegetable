<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Check, Download, ImagePlus, LoaderCircle, Upload, X } from '@lucide/vue';

import { MAX_PHOTOBANK_IMAGE_BYTES, type Photo } from '@one-vegetable/core';

import QueryState from './QueryState.vue';
import PhotoGroupNavigation from './PhotoGroupNavigation.vue';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
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

const { gateway, mode } = useServices();
const queryClient = useQueryClient();
const open = ref(false);
const selectedGroup = ref('-1');
const page = ref(1);
const pageSize = 12;
const uploadError = ref('');
const transferUrl = ref('');
const observedDimensions = ref<Record<string, { width: number; height: number }>>({});
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
const uploadsEnabled = computed(() => ['mock', 'bff', 'extension'].includes(mode));

const upload = useMutation({
  mutationFn: async (file: File) =>
    gateway.request('uploadPhoto', {
      fileName: file.name,
      contentBase64: await fileToBase64(file),
      contentType: file.type,
      byteLength: file.size,
      groupId: selectedGroup.value
    }),
  onSuccess: async (photo) => {
    choose(photo);
    uploadError.value = '';
    await queryClient.invalidateQueries({ queryKey: ['photos'] });
  },
  onError: (error: Error) => {
    uploadError.value = error.message;
  }
});
const transfer = useMutation({
  mutationFn: () =>
    gateway.request('transferPhotoFromUrl', {
      url: transferUrl.value,
      groupId: selectedGroup.value
    }),
  onSuccess: async (photo) => {
    choose(photo);
    transferUrl.value = '';
    uploadError.value = '';
    await queryClient.invalidateQueries({ queryKey: ['photos'] });
  },
  onError: (error: Error) => {
    uploadError.value = error.message;
  }
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

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file && file.size <= MAX_PHOTOBANK_IMAGE_BYTES) upload.mutate(file);
  else if (file) uploadError.value = '图库图片不能超过 5 MiB';
  input.value = '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error('读取图片文件失败'));
    };
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('读取图片文件失败'));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
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
</script>

<template>
  <div class="space-y-3">
    <div v-if="modelValue.length" class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      <div
        v-for="photo in modelValue"
        :key="photo.id"
        class="group relative overflow-hidden rounded-md border"
      >
        <img
          :src="photo.url"
          :alt="photo.name"
          class="aspect-square w-full bg-muted object-cover"
          @load="rememberDimensions(photo, $event)"
        />
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
      <div
        v-if="open"
        class="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"
        @click.self="open = false"
      >
        <Card class="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden">
          <header class="flex items-center justify-between border-b p-4">
            <div>
              <h2 class="font-semibold">国际站图库</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                已选 {{ modelValue.length }}/{{ max }}；素材 ID 会随商品 Schema 保存。
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="关闭图库" @click="open = false"
              ><X class="size-4"
            /></Button>
          </header>
          <div class="grid min-h-0 flex-1 md:grid-cols-[220px_1fr]">
            <aside class="overflow-auto border-r p-3">
              <PhotoGroupNavigation :model-value="selectedGroup" @update:model-value="changeGroup" />
              <label
                class="mt-4 flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm font-medium"
                :class="uploadsEnabled ? '' : 'cursor-not-allowed opacity-50'"
              >
                <LoaderCircle v-if="upload.isPending.value" class="size-4 animate-spin" />
                <Upload v-else class="size-4" />本地上传
                <input
                  type="file"
                  accept="image/*"
                  class="sr-only"
                  :disabled="!uploadsEnabled || upload.isPending.value"
                  @change="onFileChange"
                />
              </label>
              <p class="mt-2 text-xs text-muted-foreground">支持图片文件，单张最大 5 MiB。</p>
              <div class="mt-4 space-y-2 border-t pt-4">
                <p class="text-xs font-medium">转存外部图片</p>
                <Input
                  v-model="transferUrl"
                  aria-label="外部图片 URL"
                  placeholder="https://…"
                  :disabled="!uploadsEnabled"
                />
                <Button
                  class="w-full"
                  variant="outline"
                  size="sm"
                  :disabled="!uploadsEnabled || !transferUrl || transfer.isPending.value"
                  @click="transfer.mutate()"
                >
                  <LoaderCircle v-if="transfer.isPending.value" class="size-4 animate-spin" />
                  <Download v-else class="size-4" />下载并存入图库
                </Button>
                <p class="text-xs text-muted-foreground">仅公共 HTTP(S) 图片，最大 5 MiB。</p>
              </div>
              <p v-if="uploadError" class="mt-2 text-xs text-destructive">{{ uploadError }}</p>
            </aside>
            <main class="min-h-0 overflow-auto p-4">
              <QueryState :loading="photos.isPending.value" :error="photos.error.value">
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <button
                    v-for="photo in photos.data.value?.items ?? []"
                    :key="photo.id"
                    type="button"
                    class="relative overflow-hidden rounded-lg border text-left hover:border-primary"
                    :class="selectedIds.has(photo.id) ? 'ring-2 ring-primary' : ''"
                    @click="choose(photo)"
                  >
                    <img
                      :src="photo.url"
                      :alt="photo.name"
                      class="aspect-square w-full bg-muted object-cover"
                      @load="rememberDimensions(photo, $event)"
                    />
                    <span
                      v-if="selectedIds.has(photo.id)"
                      class="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"
                      ><Check class="size-3"
                    /></span>
                    <span class="block p-2">
                      <span class="block truncate text-sm font-medium">{{ photo.name }}</span>
                      <span class="text-xs text-muted-foreground"
                        >{{ dimensionsLabel(photo) }} · {{ Math.ceil(photo.fileSize / 1024) }} KiB</span
                      >
                    </span>
                  </button>
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
    </Teleport>
  </div>
</template>
