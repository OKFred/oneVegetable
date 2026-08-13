<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { FolderOpen, FolderPlus, Pencil, ShieldCheck, Trash2 } from '@lucide/vue';

import type { Photo, PhotoGroupOperationRequest } from '@one-vegetable/core';

import PageHeader from '../components/PageHeader.vue';
import PhotoBankPicker from '../components/PhotoBankPicker.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';

type GovernanceFilter = 'all' | 'unreferenced' | 'lowResolution';

const { gateway, mode } = useServices();
const queryClient = useQueryClient();
const selectedGroup = ref('-1');
const selectedPhotos = ref<Photo[]>([]);
const groupName = ref('');
const governanceFilter = ref<GovernanceFilter>('all');
const operationMessage = ref('');
const groups = useQuery({
  queryKey: ['photo-groups'],
  queryFn: () => gateway.request('listPhotoGroups', undefined)
});
const photos = useQuery({
  queryKey: ['photos', selectedGroup],
  queryFn: () => gateway.request('listPhotos', { page: 1, pageSize: 24, groupId: selectedGroup.value })
});
const groupMutationsEnabled = computed(() => mode === 'mock');
const selectedGroupDefinition = computed(() =>
  groups.data.value?.find((group) => group.id === selectedGroup.value)
);
const filteredPhotos = computed(() => {
  const items = photos.data.value?.items ?? [];
  if (governanceFilter.value === 'unreferenced') {
    return items.filter((photo) => photo.referenceCount === 0);
  }
  if (governanceFilter.value === 'lowResolution') {
    return items.filter((photo) => photo.width < 750 || photo.height < 750);
  }
  return items;
});
const governanceCounts = computed(() => {
  const items = photos.data.value?.items ?? [];
  return {
    unreferenced: items.filter((photo) => photo.referenceCount === 0).length,
    lowResolution: items.filter((photo) => photo.width < 750 || photo.height < 750).length
  };
});
const operateGroup = useMutation({
  mutationFn: (request: PhotoGroupOperationRequest) => gateway.request('operatePhotoGroup', request),
  onSuccess: async (group, request) => {
    operationMessage.value =
      request.operation === 'delete' ? `已删除 ${group.name}` : `分组已保存：${group.name}`;
    if (request.operation === 'delete') selectedGroup.value = '-1';
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

function fileSize(value: number): string {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`;
}
</script>

<template>
  <PageHeader title="图库" description="管理国际站图库（图片银行）的分组、发品素材与非阻断治理提示。">
    <PhotoBankPicker v-model="selectedPhotos" :max="6" button-label="选择或上传素材" />
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
      <button
        v-for="group in groups.data.value ?? []"
        :key="group.id"
        class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
        :class="selectedGroup === group.id ? 'bg-accent text-accent-foreground' : ''"
        @click="selectedGroup = group.id"
      >
        <span class="flex min-w-0 items-center gap-2" :style="{ paddingLeft: `${(group.level - 1) * 12}px` }">
          <FolderOpen class="size-4 shrink-0" /><span class="truncate">{{ group.name }}</span>
        </span>
        <span class="text-xs text-muted-foreground">{{ group.photoCount }}</span>
      </button>

      <div class="mt-3 space-y-2 border-t pt-3">
        <Input v-model="groupName" aria-label="图库分组名称" placeholder="分组名称" />
        <div class="grid grid-cols-3 gap-1">
          <Button
            size="sm"
            variant="outline"
            :disabled="!groupMutationsEnabled || !groupName.trim()"
            title="新增子分组"
            @click="mutateGroup('add')"
            ><FolderPlus class="size-3" />新增</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="!groupMutationsEnabled || selectedGroup === '-1' || !groupName.trim()"
            @click="mutateGroup('rename')"
            ><Pencil class="size-3" />改名</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="!groupMutationsEnabled || selectedGroup === '-1'"
            @click="mutateGroup('delete')"
            ><Trash2 class="size-3" />删除</Button
          >
        </div>
        <p v-if="!groupMutationsEnabled" class="text-xs text-amber-700">
          真实分组写操作尚未完成账号 smoke test。
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
            <img :src="photo.url" :alt="photo.name" class="aspect-square w-full bg-muted object-cover" />
            <div class="space-y-2 p-3">
              <p class="truncate text-sm font-medium">{{ photo.name }}</p>
              <p class="text-xs text-muted-foreground">
                {{ photo.width }} × {{ photo.height }} · {{ fileSize(photo.fileSize) }}
              </p>
              <div class="flex flex-wrap gap-1">
                <Badge variant="secondary">引用 {{ photo.referenceCount }}</Badge>
                <Badge v-if="photo.referenceCount === 0" variant="outline">建议清理</Badge>
                <Badge v-if="photo.width < 750 || photo.height < 750" variant="outline">建议换高清图</Badge>
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
</template>
