<script setup lang="ts">
import { ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { FolderOpen } from '@lucide/vue';

import type { Photo } from '@one-vegetable/core';

import PageHeader from '../components/PageHeader.vue';
import PhotoBankPicker from '../components/PhotoBankPicker.vue';
import QueryState from '../components/QueryState.vue';
import Card from '../components/ui/Card.vue';
import { useServices } from '../lib/services';

const { gateway } = useServices();
const selectedGroup = ref('-1');
const selectedPhotos = ref<Photo[]>([]);
const groups = useQuery({
  queryKey: ['photo-groups'],
  queryFn: () => gateway.request('listPhotoGroups', undefined)
});
const photos = useQuery({
  queryKey: ['photos', selectedGroup],
  queryFn: () => gateway.request('listPhotos', { page: 1, pageSize: 24, groupId: selectedGroup.value })
});
</script>

<template>
  <PageHeader
    title="图片银行"
    description="管理国际站图片分组与发品素材；上传文件时二进制内容不参与 TOP 签名。"
  >
    <PhotoBankPicker v-model="selectedPhotos" :max="6" button-label="选择或上传素材" />
  </PageHeader>
  <div class="grid gap-5 lg:grid-cols-[230px_1fr]">
    <Card class="h-fit p-3">
      <p class="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">图片分组</p>
      <button
        v-for="group in groups.data.value ?? []"
        :key="group.id"
        class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
        :class="selectedGroup === group.id ? 'bg-accent text-accent-foreground' : ''"
        @click="selectedGroup = group.id"
      >
        <span class="flex items-center gap-2"><FolderOpen class="size-4" />{{ group.name }}</span
        ><span class="text-xs text-muted-foreground">{{ group.photoCount }}</span>
      </button>
    </Card>
    <QueryState :loading="photos.isPending.value" :error="photos.error.value">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <Card v-for="photo in photos.data.value?.items ?? []" :key="photo.id" class="overflow-hidden">
          <img :src="photo.url" :alt="photo.name" class="aspect-square w-full bg-muted object-cover" />
          <div class="p-3">
            <p class="truncate text-sm font-medium">{{ photo.name }}</p>
            <p class="mt-1 text-xs text-muted-foreground">{{ photo.width }} × {{ photo.height }}</p>
          </div>
        </Card>
      </div>
    </QueryState>
  </div>
</template>
