<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CircleCheck, Download, ExternalLink, LoaderCircle, RefreshCw, Send, Share2 } from '@lucide/vue';
import { toast } from 'vue-sonner';

import {
  SOCIAL_PLATFORM_DEFINITIONS,
  encodeBase64,
  validateSocialShareSelection,
  type Photo,
  type SocialPublishingClient,
  type SocialDestination,
  type SocialPostPermalink,
  type SocialPublishJob
} from '@one-vegetable/core';

import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
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

const { gateway, control, socialPublishing, mode } = useServices();
const social = socialPublishing ?? (control as SocialPublishingClient | undefined);
const caption = ref('');
const assets = ref<PreparedSocialShareAsset[]>([]);
const preparing = ref(false);
const preparedCount = ref(0);
const feedback = ref<{ kind: 'error' | 'info'; message: string } | null>(null);
let preparationRevision = 0;
const destinations = ref<SocialDestination[]>([]);
const destinationId = ref('');
const officialBusy = ref(false);
const officialError = ref<unknown>(null);
const publishConfirmationOpen = ref(false);
const publishJob = ref<SocialPublishJob | null>(null);
const postPermalink = ref<SocialPostPermalink | null>(null);
const prepareIdempotencyKey = ref(globalThis.crypto.randomUUID());
let advanceTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

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
const selectedDestination = computed(
  () => destinations.value.find((destination) => destination.id === destinationId.value) ?? null
);
const officialPublishingSupported = computed(() => social !== undefined);
const officialIssue = computed(() => {
  if (!officialPublishingSupported.value) {
    return mode === 'extension' ? '请先在插件设置中配对社交发布后端。' : '当前后端未启用社交发布。';
  }
  if (props.photos.length !== 1) return '官方 API 每次只支持选择 1 张图片。';
  if (preparing.value) return '正在准备原图。';
  if (assets.value.length !== 1) return '原图尚未准备完成。';
  const destination = selectedDestination.value;
  if (!destination) return '请选择发布目标。';
  if (!destination.canPublish) return `该目标不可发布：${destination.unavailableReasonCode ?? '权限不足'}`;
  const asset = assets.value[0];
  if (!asset) return '图片尚未准备完成。';
  if (destination.platform === 'instagram' && asset.contentType !== 'image/jpeg') {
    return 'Instagram 首版仅接受 JPEG 图片。';
  }
  const maximum = destination.platform === 'instagram' ? 2200 : 4000;
  if (Array.from(caption.value.trim()).length > maximum) return `文案不能超过 ${maximum} 个字符。`;
  return '';
});
const publishStatusLabel = computed(() => {
  const status = publishJob.value?.status;
  const labels: Partial<Record<SocialPublishJob['status'], string>> = {
    prepared: '等待确认',
    processing: '平台处理中',
    published: '发布成功',
    failed: '发布失败',
    unknown: '结果未知',
    cancelled: '已取消',
    expired: '已过期'
  };
  return status ? (labels[status] ?? status) : '';
});

watch(
  [() => props.open, selectionKey],
  ([open], previous) => {
    if (!open) return;
    if (!previous[0] || previous[1] !== selectionKey.value) caption.value = '';
    void prepareAssets();
    void refreshOfficialPublishing();
  },
  { immediate: true }
);

watch([destinationId, caption, selectionKey], () => {
  prepareIdempotencyKey.value = globalThis.crypto.randomUUID();
  postPermalink.value = null;
  if (publishJob.value?.status === 'prepared') publishJob.value = null;
});

watch(
  () => publishJob.value?.id,
  (jobId, previousJobId) => {
    if (jobId !== previousJobId) postPermalink.value = null;
  }
);

watch(
  () => publishJob.value,
  (job) => {
    scheduleAdvance(job);
  },
  { deep: true }
);

onBeforeUnmount(() => {
  clearAdvanceTimer();
});

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

async function refreshOfficialPublishing(): Promise<void> {
  if (!officialPublishingSupported.value || !social?.listSocialDestinations) return;
  officialBusy.value = true;
  officialError.value = null;
  try {
    const [nextDestinations, recentJobs] = await Promise.all([
      social.listSocialDestinations(),
      social.listSocialPosts(20)
    ]);
    destinations.value = nextDestinations;
    if (!nextDestinations.some((destination) => destination.id === destinationId.value)) {
      destinationId.value = nextDestinations.find((destination) => destination.canPublish)?.id ?? '';
    }
    const active = recentJobs.find(
      (job) => job.status === 'processing' && nextDestinations.some((item) => item.id === job.destinationId)
    );
    if (active) publishJob.value = active;
  } catch (error: unknown) {
    officialError.value = error;
  } finally {
    officialBusy.value = false;
  }
}

async function prepareOfficialPublish(): Promise<void> {
  const issue = officialIssue.value;
  const asset = assets.value[0];
  if (issue || !asset || !social?.prepareSocialPost) return;
  officialBusy.value = true;
  officialError.value = null;
  try {
    publishJob.value = await social.prepareSocialPost({
      destinationId: destinationId.value,
      caption: caption.value.trim(),
      idempotencyKey: prepareIdempotencyKey.value,
      file: {
        fileName: asset.fileName,
        contentBase64: encodeBase64(asset.bytes),
        contentType: asset.contentType,
        byteLength: asset.bytes.byteLength
      }
    });
    publishConfirmationOpen.value = true;
  } catch (error: unknown) {
    officialError.value = error;
  } finally {
    officialBusy.value = false;
  }
}

async function confirmOfficialPublish(): Promise<void> {
  const job = publishJob.value;
  if (!job || !social?.publishSocialPost) return;
  officialBusy.value = true;
  officialError.value = null;
  try {
    publishJob.value = await social.publishSocialPost(job.id);
    publishConfirmationOpen.value = false;
    notifyPublishStatus(publishJob.value);
  } catch (error: unknown) {
    officialError.value = error;
  } finally {
    officialBusy.value = false;
  }
}

async function advanceOfficialPublish(): Promise<void> {
  const job = publishJob.value;
  if (job?.status !== 'processing' || !social?.advanceSocialPost || officialBusy.value) return;
  officialBusy.value = true;
  officialError.value = null;
  try {
    publishJob.value = await social.advanceSocialPost(job.id);
    notifyPublishStatus(publishJob.value);
  } catch (error: unknown) {
    officialError.value = error;
  } finally {
    officialBusy.value = false;
  }
}

async function getOfficialPostPermalink(): Promise<void> {
  const job = publishJob.value;
  if (job?.status !== 'published' || !social?.getSocialPostPermalink || officialBusy.value) return;
  officialBusy.value = true;
  officialError.value = null;
  try {
    postPermalink.value = await social.getSocialPostPermalink(job.id);
    toast.success('已获取平台内容链接');
  } catch (error: unknown) {
    officialError.value = error;
  } finally {
    officialBusy.value = false;
  }
}

function scheduleAdvance(job: SocialPublishJob | null): void {
  clearAdvanceTimer();
  if (job?.platform !== 'instagram' || job.status !== 'processing') return;
  const delay = Math.max(0, (job.nextAdvanceTimeUtc ?? Date.now() + 60_000) - Date.now());
  advanceTimer = globalThis.setTimeout(
    () => {
      void advanceOfficialPublish();
    },
    Math.min(delay, 2_147_483_647)
  );
}

function clearAdvanceTimer(): void {
  if (advanceTimer !== undefined) globalThis.clearTimeout(advanceTimer);
  advanceTimer = undefined;
}

function notifyPublishStatus(job: SocialPublishJob | null): void {
  if (!job) return;
  if (job.status === 'published') toast.success('图片已通过官方 API 发布');
  else if (job.status === 'processing') toast.info('Instagram 正在处理图片，将在约 1 分钟后刷新');
  else if (job.status === 'unknown') toast.warning('发布结果未知，系统不会自动重发，请到平台核对');
  else if (job.status === 'failed') toast.error(job.message ?? '平台拒绝了发布请求');
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
          <Button
            v-if="assets.length === 0 && feedback?.kind === 'error' && selectionIssues.length === 0"
            variant="outline"
            @click="prepareAssets"
          >
            <RefreshCw class="size-4" />重新准备原图
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
        <div class="rounded-lg border bg-card p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 class="font-semibold">发布到已连接账号</h4>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                每次只发布一张图片到一个目标；点击发布前还会再次确认。
              </p>
            </div>
            <Badge :variant="destinations.some((item) => item.canPublish) ? 'success' : 'secondary'">
              {{ destinations.filter((item) => item.canPublish).length }} 个可用目标
            </Badge>
          </div>

          <div v-if="officialPublishingSupported" class="mt-4 space-y-3">
            <label class="block space-y-1 text-sm">
              <span>发布目标</span>
              <select
                v-model="destinationId"
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :disabled="officialBusy"
              >
                <option value="">请选择目标</option>
                <option
                  v-for="destination in destinations"
                  :key="destination.id"
                  :value="destination.id"
                  :disabled="!destination.canPublish"
                >
                  {{ destination.platform === 'facebook' ? 'Facebook' : 'Instagram' }} · {{ destination.name
                  }}{{ destination.canPublish ? '' : '（不可用）' }}
                </option>
              </select>
            </label>
            <p v-if="officialIssue" class="text-xs text-amber-700 dark:text-amber-300">
              {{ officialIssue }}
            </p>
            <ErrorNotice v-if="officialError" :error="officialError" fallback="社交发布失败" compact />
            <div v-if="publishJob" class="rounded-md bg-muted/50 p-3 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="flex items-center gap-2 font-medium">
                  <CircleCheck v-if="publishJob.status === 'published'" class="size-4 text-emerald-600" />
                  <LoaderCircle
                    v-else-if="publishJob.status === 'processing'"
                    class="size-4 animate-spin text-primary"
                  />
                  {{ publishStatusLabel }}
                </span>
                <code class="text-xs text-muted-foreground">{{ publishJob.id.slice(0, 8) }}</code>
              </div>
              <p v-if="publishJob.message" class="mt-2 text-xs text-muted-foreground">
                {{ publishJob.message }}
              </p>
              <p v-if="publishJob.platformPostId" class="mt-2 text-xs text-muted-foreground">
                平台发布 ID：{{ publishJob.platformPostId }}
              </p>
              <div v-if="publishJob.status === 'published'" class="mt-3">
                <a
                  v-if="postPermalink"
                  :href="postPermalink.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  在 {{ postPermalink.platform === 'facebook' ? 'Facebook' : 'Instagram' }} 查看
                  <ExternalLink class="size-3.5" />
                </a>
                <Button
                  v-else
                  variant="outline"
                  size="sm"
                  :disabled="officialBusy"
                  @click="getOfficialPostPermalink"
                >
                  <LoaderCircle v-if="officialBusy" class="size-4 animate-spin" />
                  <ExternalLink v-else class="size-4" />
                  获取 {{ publishJob.platform === 'facebook' ? 'Facebook' : 'Instagram' }} 链接
                </Button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button :disabled="officialBusy || Boolean(officialIssue)" @click="prepareOfficialPublish">
                <Send class="size-4" />检查并发布
              </Button>
              <Button
                v-if="publishJob?.status === 'processing'"
                variant="outline"
                :disabled="officialBusy"
                @click="advanceOfficialPublish"
              >
                <RefreshCw class="size-4" />刷新进度
              </Button>
            </div>
          </div>
          <p v-else class="mt-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            {{ officialIssue }}
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
              <Badge
                :variant="
                  destinations.some((item) => item.platform === platform.id && item.canPublish)
                    ? 'success'
                    : 'outline'
                "
              >
                {{
                  destinations.some((item) => item.platform === platform.id && item.canPublish)
                    ? '已连接'
                    : '需要配置'
                }}
              </Badge>
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

  <ConfirmActionDialog
    :open="publishConfirmationOpen"
    title="确认通过官方 API 发布"
    :description="`将把当前图片发布到 ${selectedDestination?.name ?? '所选目标'}。平台发布属于真实外部写操作，提交后不会自动删除。`"
    confirm-label="确认发布"
    :pending="officialBusy"
    @update:open="publishConfirmationOpen = $event"
    @confirm="confirmOfficialPublish"
  />
</template>
