<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { LoaderCircle } from '@lucide/vue';

import { MAX_PHOTOBANK_IMAGE_BYTES, type Photo } from '@one-vegetable/core';

import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import {
  operationAvailabilityMessage,
  useOperationAvailability
} from '../composables/use-operation-availability';
import { useServices } from '../lib/services';

const props = withDefaults(
  defineProps<{
    open: boolean;
    groupId: string;
    groupName?: string;
  }>(),
  { groupName: '全部图片' }
);
const emit = defineEmits<{
  'update:open': [open: boolean];
  uploaded: [photo: Photo];
}>();

const { gateway } = useServices();
const queryClient = useQueryClient();
const fileInput = ref<HTMLInputElement | null>(null);
const transferUrl = ref('');
const feedback = ref<{ kind: 'success' | 'error'; message: string } | null>(null);
const photoMutations = useOperationAvailability(['uploadPhoto', 'transferPhotoFromUrl']);
const uploadBlocked = computed(() => !photoMutations.isAllowed('uploadPhoto'));
const transferBlocked = computed(() => !photoMutations.isAllowed('transferPhotoFromUrl'));
const uploadBlockedReason = computed(() =>
  operationAvailabilityMessage(photoMutations.reasonCode('uploadPhoto'), '当前环境未开放本地图片上传')
);
const transferBlockedReason = computed(() =>
  operationAvailabilityMessage(
    photoMutations.reasonCode('transferPhotoFromUrl'),
    '当前环境未开放外部 URL 转存'
  )
);

const upload = useMutation({
  mutationFn: async (file: File) =>
    gateway.request('uploadPhoto', {
      fileName: file.name,
      contentBase64: await fileToBase64(file),
      contentType: file.type,
      byteLength: file.size,
      groupId: props.groupId
    }),
  onMutate: () => {
    feedback.value = null;
  },
  onSuccess: async (photo) => {
    feedback.value = { kind: 'success', message: `已上传到图库：${photo.name}` };
    emit('uploaded', photo);
    await queryClient.invalidateQueries({ queryKey: ['photos'] });
  },
  onError: (error: Error) => {
    feedback.value = { kind: 'error', message: error.message };
  }
});

const transfer = useMutation({
  mutationFn: () =>
    gateway.request('transferPhotoFromUrl', {
      url: transferUrl.value,
      groupId: props.groupId
    }),
  onMutate: () => {
    feedback.value = null;
  },
  onSuccess: async (photo) => {
    transferUrl.value = '';
    feedback.value = { kind: 'success', message: `已转存到图库：${photo.name}` };
    emit('uploaded', photo);
    await queryClient.invalidateQueries({ queryKey: ['photos'] });
  },
  onError: (error: Error) => {
    feedback.value = { kind: 'error', message: error.message };
  }
});

function chooseLocalFile(): void {
  if (uploadBlocked.value) {
    feedback.value = { kind: 'error', message: uploadBlockedReason.value };
    return;
  }
  fileInput.value?.click();
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file && uploadBlocked.value) feedback.value = { kind: 'error', message: uploadBlockedReason.value };
  else if (file && file.size <= MAX_PHOTOBANK_IMAGE_BYTES) upload.mutate(file);
  else if (file) feedback.value = { kind: 'error', message: '图库图片不能超过 5 MiB' };
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
</script>

<template>
  <ModalDialog
    :open="open"
    title="上传图片到图库"
    :description="`上传到“${groupName}”；不会自动选入商品。`"
    @update:open="emit('update:open', $event)"
  >
    <div class="space-y-4">
      <section class="space-y-3">
        <div>
          <h3 class="text-sm font-semibold">从本机上传</h3>
          <p class="mt-1 text-xs text-muted-foreground">支持常见图片格式，单张最大 5 MiB。</p>
        </div>
        <Button class="w-full" :disabled="uploadBlocked || upload.isPending.value" @click="chooseLocalFile">
          <LoaderCircle v-if="upload.isPending.value" class="size-4 animate-spin" />
          {{ upload.isPending.value ? '正在上传…' : '选择本地图片并上传' }}
        </Button>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/bmp,image/avif"
          class="sr-only"
          :disabled="uploadBlocked || upload.isPending.value"
          @change="onFileChange"
        />
      </section>

      <section class="space-y-3 border-t pt-4">
        <div>
          <h3 class="text-sm font-semibold">从外部 URL 转存</h3>
          <p class="mt-1 text-xs text-muted-foreground">仅支持不超过 5 MiB 的公共 HTTP(S) 图片。</p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row">
          <Input
            v-model="transferUrl"
            class="flex-1"
            aria-label="外部图片 URL"
            placeholder="https://…"
            :disabled="transferBlocked || transfer.isPending.value"
          />
          <Button
            variant="outline"
            :disabled="transferBlocked || !transferUrl.trim() || transfer.isPending.value"
            @click="transfer.mutate()"
          >
            <LoaderCircle v-if="transfer.isPending.value" class="size-4 animate-spin" />
            {{ transfer.isPending.value ? '正在转存…' : '下载并存入图库' }}
          </Button>
        </div>
      </section>

      <div v-if="uploadBlocked || transferBlocked" class="rounded-md border border-amber-300 p-3 text-xs">
        <p v-if="uploadBlocked">{{ uploadBlockedReason }}</p>
        <p v-if="transferBlocked">{{ transferBlockedReason }}</p>
      </div>

      <p
        v-if="feedback"
        class="rounded-md border p-3 text-sm"
        :class="feedback.kind === 'success' ? 'text-emerald-700' : 'text-destructive'"
        :role="feedback.kind === 'error' ? 'alert' : 'status'"
      >
        {{ feedback.message }}
      </p>
    </div>
  </ModalDialog>
</template>
