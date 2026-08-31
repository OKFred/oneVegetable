<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Download, ExternalLink, LoaderCircle, Share2 } from '@lucide/vue';
import { toast } from 'vue-sonner';

import { SOCIAL_PLATFORM_DEFINITIONS, validateSocialShareSelection, type Photo } from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import { useServices } from '../lib/services';
import {
  createNativeShareFiles,
  createSocialShareArchive,
  normalizeSocialShareCaption,
  prepareSocialShareAssets,
  type PreparedSocialShareAsset
} from '../lib/social-share-package';

const props = defineProps<{ open: boolean; photos: readonly Photo[] }>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();

const { gateway } = useServices();
const caption = ref('');
const assets = ref<PreparedSocialShareAsset[]>([]);
const preparing = ref(false);
const preparedCount = ref(0);
const feedback = ref<{ kind: 'error' | 'info'; message: string } | null>(null);
let preparationRevision = 0;

const selectionKey = computed(() => props.photos.map((photo) => `${photo.id}:${photo.url}`).join('|'));
const selectionIssues = computed(() =>
  validateSocialShareSelection(
    props.photos.length,
    props.photos.reduce((total, photo) => total + photo.fileSize, 0)
  )
);
const files = computed(() => createNativeShareFiles(assets.value));
const systemShareSupported = computed(() => {
  if (assets.value.length === 0 || typeof globalThis.navigator.canShare !== 'function') return false;
  try {
    return globalThis.navigator.canShare({ files: files.value });
  } catch {
    return false;
  }
});

watch(
  [() => props.open, selectionKey],
  ([open], previous) => {
    if (!open) return;
    if (!previous[0] || previous[1] !== selectionKey.value) caption.value = '';
    void prepareAssets();
  },
  { immediate: true }
);

async function prepareAssets(): Promise<void> {
  const revision = ++preparationRevision;
  assets.value = [];
  preparedCount.value = 0;
  feedback.value = null;
  if (selectionIssues.value.length > 0) {
    feedback.value = { kind: 'error', message: selectionIssues.value[0] ?? '所选图片无效' };
    return;
  }
  preparing.value = true;
  try {
    const prepared = await prepareSocialShareAssets(props.photos, gateway, (current) => {
      if (revision === preparationRevision) preparedCount.value = current;
    });
    if (revision !== preparationRevision) return;
    assets.value = prepared;
  } catch (error: unknown) {
    if (revision !== preparationRevision) return;
    feedback.value = { kind: 'error', message: toError(error).message };
  } finally {
    if (revision === preparationRevision) preparing.value = false;
  }
}

async function shareWithSystem(): Promise<void> {
  feedback.value = null;
  if (!systemShareSupported.value || typeof globalThis.navigator.share !== 'function') {
    feedback.value = {
      kind: 'info',
      message: '当前浏览器或系统不支持分享原图，请下载 ZIP 分享包后手工发布。'
    };
    return;
  }
  try {
    const text = normalizeSocialShareCaption(caption.value);
    await globalThis.navigator.share({
      files: files.value,
      title: 'oneVegetable 图库素材',
      ...(text ? { text } : {})
    });
    toast.success('素材已交给系统分享面板；最终发布仍由所选应用确认');
  } catch (error: unknown) {
    const resolved = toError(error);
    if (resolved.name === 'AbortError') return;
    feedback.value = { kind: 'error', message: resolved.message };
  }
}

async function downloadSharePackage(): Promise<void> {
  feedback.value = null;
  try {
    const archive = await createSocialShareArchive(assets.value, caption.value);
    const url = URL.createObjectURL(new Blob([Uint8Array.from(archive).buffer], { type: 'application/zip' }));
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = `one-vegetable-social-share-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`已下载 ${assets.value.length} 张图片的分享包`);
  } catch (error: unknown) {
    feedback.value = { kind: 'error', message: toError(error).message };
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
</script>

<template>
  <ModalDialog
    :open="open"
    title="分享图库素材"
    :description="`已选择 ${photos.length} 张图片；不会保存 Facebook、Instagram、X 或 TikTok 密码。`"
    size="lg"
    @update:open="emit('update:open', $event)"
  >
    <div class="space-y-5">
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold">分享内容</h3>
            <p class="mt-1 text-xs text-muted-foreground">原图由统一网关读取，页面不会直接访问外部 CDN。</p>
          </div>
          <Badge variant="secondary">{{ photos.length }} 张</Badge>
        </div>
        <div class="flex gap-2 overflow-x-auto pb-1">
          <img
            v-for="photo in photos"
            :key="photo.id"
            :src="photo.previewUrl ?? photo.url"
            :alt="photo.name"
            class="size-20 shrink-0 rounded-md border object-cover"
          />
        </div>
        <label class="block space-y-1 text-sm font-medium">
          <span>分享文案</span>
          <textarea
            v-model="caption"
            maxlength="4000"
            rows="4"
            class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="输入产品卖点、话题标签或发布备注…"
          />
          <span class="block text-right text-xs font-normal text-muted-foreground">
            {{ caption.length }}/4000
          </span>
        </label>
      </section>

      <section class="rounded-lg border p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold">立即分享</h3>
            <p class="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
              系统分享会把原图交给设备的分享面板，由你选择已安装并已登录的平台；oneVegetable
              无法读取你最终选择了哪个应用。
            </p>
          </div>
          <Badge :variant="systemShareSupported ? 'success' : 'secondary'">
            {{ systemShareSupported ? '系统支持原图分享' : '建议下载分享包' }}
          </Badge>
        </div>
        <div
          v-if="preparing"
          class="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle class="size-4 animate-spin" />正在准备原图 {{ preparedCount }}/{{ photos.length }}
        </div>
        <div v-else class="mt-4 flex flex-wrap gap-2">
          <Button :disabled="assets.length === 0" @click="shareWithSystem">
            <Share2 class="size-4" />使用系统分享
          </Button>
          <Button variant="outline" :disabled="assets.length === 0" @click="downloadSharePackage">
            <Download class="size-4" />下载 ZIP 分享包
          </Button>
        </div>
      </section>

      <section class="space-y-3">
        <div>
          <h3 class="text-sm font-semibold">官方 API 自动发布</h3>
          <p class="mt-1 text-xs text-muted-foreground">
            以下平台都需要事先连接账号和通过相应开发者权限；当前版本不会用页面自动化绕过审核。
          </p>
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <article
            v-for="platform in SOCIAL_PLATFORM_DEFINITIONS"
            :key="platform.id"
            class="rounded-lg border bg-card p-4"
          >
            <div class="flex items-center justify-between gap-3">
              <h4 class="font-semibold">{{ platform.label }}</h4>
              <Badge variant="outline">需要配置</Badge>
            </div>
            <p class="mt-2 text-xs font-medium text-muted-foreground">发布到：{{ platform.destination }}</p>
            <ul class="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              <li>{{ platform.accountRequirement }}</li>
              <li>{{ platform.apiRequirement }}</li>
              <li>{{ platform.mediaRequirement }}</li>
            </ul>
            <a
              :href="platform.documentationUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              查看官方接入要求<ExternalLink class="size-3" />
            </a>
          </article>
        </div>
      </section>

      <p
        v-if="feedback"
        class="rounded-md border p-3 text-sm"
        :class="feedback.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'"
        :role="feedback.kind === 'error' ? 'alert' : 'status'"
      >
        {{ feedback.message }}
      </p>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <Button variant="outline" @click="emit('update:open', false)">关闭</Button>
      </div>
    </template>
  </ModalDialog>
</template>
