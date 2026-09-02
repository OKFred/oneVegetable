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
import { useUiI18n } from '../i18n';
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
const { locale, t } = useUiI18n();
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
    props.photos.reduce((total, photo) => total + photo.fileSize, 0),
    locale.value
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
    return t(
      mode === 'extension' ? 'photos.social.unavailable.extension' : 'photos.social.unavailable.backend'
    );
  }
  if (props.photos.length !== 1) return t('photos.social.unavailable.onePhoto');
  if (preparing.value) return t('photos.social.unavailable.preparing');
  if (assets.value.length !== 1) return t('photos.social.unavailable.notPrepared');
  const destination = selectedDestination.value;
  if (!destination) return t('photos.social.unavailable.chooseDestination');
  if (!destination.canPublish) {
    return t('photos.social.unavailable.destination', {
      reason: destination.unavailableReasonCode ?? t('photos.social.unavailable.permission')
    });
  }
  const asset = assets.value[0];
  if (!asset) return t('photos.social.unavailable.notPrepared');
  if (destination.platform === 'instagram' && asset.contentType !== 'image/jpeg') {
    return t('photos.social.unavailable.instagramJpeg');
  }
  const maximum = destination.platform === 'instagram' ? 2200 : 4000;
  if (Array.from(caption.value.trim()).length > maximum) {
    return t('photos.social.unavailable.captionTooLong', { maximum });
  }
  return '';
});
const publishStatusLabel = computed(() => {
  const status = publishJob.value?.status;
  return status ? t(`photos.social.status.${status}`) : '';
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
    feedback.value = {
      kind: 'error',
      message: selectionIssues.value[0] ?? t('photos.social.unavailable.invalidSelection')
    };
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
      message: t('photos.social.feedback.systemUnavailable')
    };
    return;
  }
  try {
    const text = normalizeSocialShareCaption(caption.value);
    await globalThis.navigator.share({
      files: files.value,
      title: t('photos.social.shareTitle'),
      ...(text ? { text } : {})
    });
    toast.success(t('photos.social.feedback.systemOpened'));
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
    toast.success(t('photos.social.feedback.archiveDownloaded', { count: assets.value.length }));
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
    toast.success(t('photos.social.feedback.permalinkReady'));
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
  if (job.status === 'published') toast.success(t('photos.social.feedback.published'));
  else if (job.status === 'processing') toast.info(t('photos.social.feedback.instagramProcessing'));
  else if (job.status === 'unknown') toast.warning(t('photos.social.feedback.unknown'));
  else if (job.status === 'failed') toast.error(job.message ?? t('photos.social.feedback.platformRejected'));
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="t('photos.social.dialogTitle')"
    :description="t('photos.social.dialogDescription', { count: photos.length })"
    size="lg"
    @update:open="emit('update:open', $event)"
  >
    <div class="space-y-5">
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold">{{ t('photos.social.contentTitle') }}</h3>
            <p class="mt-1 text-xs text-muted-foreground">{{ t('photos.social.contentDescription') }}</p>
          </div>
          <Badge variant="secondary">{{ t('photos.social.photoCount', { count: photos.length }) }}</Badge>
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
          <span>{{ t('photos.social.caption') }}</span>
          <textarea
            v-model="caption"
            maxlength="4000"
            rows="4"
            class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
            :placeholder="t('photos.social.captionPlaceholder')"
          />
          <span class="block text-right text-xs font-normal text-muted-foreground">
            {{ caption.length }}/4000
          </span>
        </label>
      </section>

      <section class="rounded-lg border p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold">{{ t('photos.social.quickTitle') }}</h3>
            <p class="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
              {{ t('photos.social.quickDescription') }}
            </p>
          </div>
          <Badge :variant="systemShareSupported ? 'success' : 'secondary'">
            {{
              systemShareSupported ? t('photos.social.systemSupported') : t('photos.social.downloadSuggested')
            }}
          </Badge>
        </div>
        <div
          v-if="preparing"
          class="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle class="size-4 animate-spin" />{{
            t('photos.social.preparingProgress', { current: preparedCount, total: photos.length })
          }}
        </div>
        <div v-else class="mt-4 flex flex-wrap gap-2">
          <Button :disabled="assets.length === 0" @click="shareWithSystem">
            <Share2 class="size-4" />{{ t('photos.social.systemAction') }}
          </Button>
          <Button variant="outline" :disabled="assets.length === 0" @click="downloadSharePackage">
            <Download class="size-4" />{{ t('photos.social.downloadArchive') }}
          </Button>
          <Button
            v-if="assets.length === 0 && feedback?.kind === 'error' && selectionIssues.length === 0"
            variant="outline"
            @click="prepareAssets"
          >
            <RefreshCw class="size-4" />{{ t('photos.social.retryPreparation') }}
          </Button>
        </div>
      </section>

      <section class="space-y-3">
        <div>
          <h3 class="text-sm font-semibold">{{ t('photos.social.officialTitle') }}</h3>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('photos.social.officialDescription') }}
          </p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 class="font-semibold">{{ t('photos.social.connectedTitle') }}</h4>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ t('photos.social.connectedDescription') }}
              </p>
            </div>
            <Badge :variant="destinations.some((item) => item.canPublish) ? 'success' : 'secondary'">
              {{
                t('photos.social.availableDestinations', {
                  count: destinations.filter((item) => item.canPublish).length
                })
              }}
            </Badge>
          </div>

          <div v-if="officialPublishingSupported" class="mt-4 space-y-3">
            <label class="block space-y-1 text-sm">
              <span>{{ t('photos.social.destination') }}</span>
              <select
                v-model="destinationId"
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :disabled="officialBusy"
              >
                <option value="">{{ t('photos.social.chooseDestination') }}</option>
                <option
                  v-for="destination in destinations"
                  :key="destination.id"
                  :value="destination.id"
                  :disabled="!destination.canPublish"
                >
                  {{ destination.platform === 'facebook' ? 'Facebook' : 'Instagram' }} · {{ destination.name
                  }}{{ destination.canPublish ? '' : t('photos.social.destinationUnavailable') }}
                </option>
              </select>
            </label>
            <p v-if="officialIssue" class="text-xs text-amber-700 dark:text-amber-300">
              {{ officialIssue }}
            </p>
            <ErrorNotice
              v-if="officialError"
              :error="officialError"
              :fallback="t('photos.social.publishingFailed')"
              compact
            />
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
                {{ t('photos.social.platformPostId', { id: publishJob.platformPostId }) }}
              </p>
              <div v-if="publishJob.status === 'published'" class="mt-3">
                <a
                  v-if="postPermalink"
                  :href="postPermalink.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {{
                    t('photos.social.viewOn', {
                      platform: postPermalink.platform === 'facebook' ? 'Facebook' : 'Instagram'
                    })
                  }}
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
                  {{
                    t('photos.social.getLink', {
                      platform: publishJob.platform === 'facebook' ? 'Facebook' : 'Instagram'
                    })
                  }}
                </Button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button :disabled="officialBusy || Boolean(officialIssue)" @click="prepareOfficialPublish">
                <Send class="size-4" />{{ t('photos.social.publishAction') }}
              </Button>
              <Button
                v-if="publishJob?.status === 'processing'"
                variant="outline"
                :disabled="officialBusy"
                @click="advanceOfficialPublish"
              >
                <RefreshCw class="size-4" />{{ t('photos.social.refreshProgress') }}
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
                    ? t('photos.social.connected')
                    : t('photos.social.needsConfiguration')
                }}
              </Badge>
            </div>
            <p class="mt-2 text-xs font-medium text-muted-foreground">
              {{
                t('photos.social.publishTo', {
                  destination: t(`photos.social.requirements.${platform.id}.destination`)
                })
              }}
            </p>
            <ul class="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              <li>{{ t(`photos.social.requirements.${platform.id}.account`) }}</li>
              <li>{{ t(`photos.social.requirements.${platform.id}.api`) }}</li>
              <li>{{ t(`photos.social.requirements.${platform.id}.media`) }}</li>
            </ul>
            <a
              :href="platform.documentationUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {{ t('photos.social.viewRequirements') }}<ExternalLink class="size-3" />
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
        <Button variant="outline" @click="emit('update:open', false)">{{ t('common.actions.close') }}</Button>
      </div>
    </template>
  </ModalDialog>

  <ConfirmActionDialog
    :open="publishConfirmationOpen"
    :title="t('photos.social.confirmTitle')"
    :description="
      t('photos.social.confirmDescription', {
        name: selectedDestination?.name ?? t('photos.social.selectedDestination')
      })
    "
    :confirm-label="t('photos.social.confirmPublish')"
    :pending="officialBusy"
    @update:open="publishConfirmationOpen = $event"
    @confirm="confirmOfficialPublish"
  />
</template>
