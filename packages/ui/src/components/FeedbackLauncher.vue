<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Camera, ExternalLink, ImageOff, MessageCircleQuestion, RefreshCw, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';

import { APP_VERSION } from '@one-vegetable/core/version';

import { useUiI18n } from '../i18n';
import { buildGitHubFeedbackUrl, type FeedbackEnvironmentInput, type FeedbackKind } from '../lib/feedback';
import { captureFeedbackScreenshot, type FeedbackScreenshot } from '../lib/feedback-screenshot';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import Tooltip from './ui/Tooltip.vue';

const props = defineProps<{ mode: 'mock' | 'extension' | 'bff' }>();
const { locale, t } = useUiI18n();
const open = ref(false);
const kind = ref<FeedbackKind>('bug');
const title = ref('');
const details = ref('');
const reproduction = ref('');
const acknowledged = ref(false);
const screenshot = ref<FeedbackScreenshot | null>(null);
const screenshotUrl = ref<string | null>(null);
const capturing = ref(false);
const openingGitHub = ref(false);
const error = ref<string | null>(null);

const validText = computed(() => title.value.trim().length >= 3 && details.value.trim().length >= 10);
const canOpenGitHub = computed(
  () => validText.value && screenshot.value !== null && acknowledged.value && !openingGitHub.value
);

function openDialog(): void {
  error.value = null;
  open.value = true;
}

function updateOpen(nextOpen: boolean): void {
  if (capturing.value || openingGitHub.value) return;
  open.value = nextOpen;
  if (!nextOpen) resetDraft();
}

async function captureCurrentPage(): Promise<void> {
  const root = globalThis.document.querySelector<HTMLElement>('[data-feedback-capture-root]');
  if (!root) return;
  capturing.value = true;
  error.value = null;
  try {
    const nextScreenshot = await captureFeedbackScreenshot(root);
    replaceScreenshot(nextScreenshot);
  } catch (cause) {
    error.value =
      cause instanceof Error && cause.message === 'FEEDBACK_SCREENSHOT_TOO_LARGE'
        ? t('feedback.screenshot.tooLarge')
        : t('feedback.screenshot.failed');
  } finally {
    capturing.value = false;
  }
}

async function openGitHubIssue(): Promise<void> {
  if (!canOpenGitHub.value || !screenshot.value) {
    error.value = validText.value ? t('feedback.screenshot.required') : t('feedback.errors.invalid');
    return;
  }

  let issueUrl: string;
  try {
    issueUrl = buildGitHubFeedbackUrl({
      kind: kind.value,
      kindFormValue: t(`feedback.kind.formValue.${kind.value}`),
      title: title.value,
      details: details.value,
      reproduction: reproduction.value,
      environment: currentEnvironment()
    });
  } catch {
    error.value = t('feedback.errors.urlTooLong');
    return;
  }

  openingGitHub.value = true;
  error.value = null;
  const popup = globalThis.open('about:blank', '_blank');
  if (popup) popup.opener = null;

  try {
    const copied = await copyScreenshot(screenshot.value.blob);
    if (copied) toast.success(t('feedback.status.clipboardReady'));
    else {
      downloadScreenshot(screenshot.value);
      toast.warning(t('feedback.status.downloaded'));
    }

    if (popup) popup.location.replace(issueUrl);
    else {
      openIssueWithAnchor(issueUrl);
      toast.warning(t('feedback.status.popupBlocked'));
    }
    open.value = false;
    resetDraft();
  } finally {
    openingGitHub.value = false;
  }
}

function currentEnvironment(): FeedbackEnvironmentInput {
  return {
    appVersion: APP_VERSION,
    capturedAtUtc: new Date().toISOString(),
    devicePixelRatio: globalThis.devicePixelRatio,
    mode: props.mode,
    route: globalThis.location.hash,
    theme: globalThis.document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    uiLocale: locale.value,
    userAgent: globalThis.navigator.userAgent,
    viewportHeight: globalThis.innerHeight,
    viewportWidth: globalThis.innerWidth
  };
}

async function copyScreenshot(blob: Blob): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.write([new globalThis.ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

function downloadScreenshot(value: FeedbackScreenshot): void {
  const url = URL.createObjectURL(value.blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = value.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function openIssueWithAnchor(issueUrl: string): void {
  const link = globalThis.document.createElement('a');
  link.href = issueUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}

function replaceScreenshot(value: FeedbackScreenshot): void {
  releaseScreenshot();
  screenshot.value = value;
  screenshotUrl.value = URL.createObjectURL(value.blob);
}

function removeScreenshot(): void {
  releaseScreenshot();
  acknowledged.value = false;
}

function releaseScreenshot(): void {
  if (screenshotUrl.value) URL.revokeObjectURL(screenshotUrl.value);
  screenshotUrl.value = null;
  screenshot.value = null;
}

function resetDraft(): void {
  releaseScreenshot();
  kind.value = 'bug';
  title.value = '';
  details.value = '';
  reproduction.value = '';
  acknowledged.value = false;
  error.value = null;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

onBeforeUnmount(releaseScreenshot);
</script>

<template>
  <div data-feedback-ignore>
    <Tooltip :text="t('feedback.launcher')" side="left">
      <Button
        size="icon"
        class="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-[max(1.5rem,env(safe-area-inset-right))] z-50 size-12 rounded-full shadow-lg transition-transform hover:-translate-y-0.5"
        :aria-label="t('feedback.launcher')"
        data-testid="feedback-launcher"
        @click="openDialog"
      >
        <MessageCircleQuestion class="size-5" />
      </Button>
    </Tooltip>

    <ModalDialog
      :open="open"
      :title="t('feedback.title')"
      :description="t('feedback.description')"
      size="lg"
      @update:open="updateOpen"
    >
      <form class="space-y-5" @submit.prevent="openGitHubIssue">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-medium">
            {{ t('feedback.kind.label') }}
            <select
              v-model="kind"
              class="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="bug">{{ t('feedback.kind.bug') }}</option>
              <option value="experience">{{ t('feedback.kind.experience') }}</option>
              <option value="feature">{{ t('feedback.kind.feature') }}</option>
            </select>
          </label>
          <label class="text-sm font-medium">
            {{ t('feedback.fields.title') }}
            <input
              v-model="title"
              required
              minlength="3"
              maxlength="100"
              class="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              :placeholder="t('feedback.fields.titlePlaceholder')"
            />
          </label>
        </div>

        <label class="block text-sm font-medium">
          {{ t('feedback.fields.details') }}
          <textarea
            v-model="details"
            required
            minlength="10"
            maxlength="1200"
            rows="5"
            class="mt-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            :placeholder="t('feedback.fields.detailsPlaceholder')"
          />
        </label>

        <label class="block text-sm font-medium">
          {{ t('feedback.fields.reproduction') }}
          <textarea
            v-model="reproduction"
            maxlength="800"
            rows="4"
            class="mt-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            :placeholder="t('feedback.fields.reproductionPlaceholder')"
          />
        </label>

        <section class="rounded-lg border bg-muted/30 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-medium">{{ t('feedback.screenshot.title') }}</h3>
              <p class="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                {{ t('feedback.screenshot.description') }}
              </p>
            </div>
            <Button type="button" variant="outline" :disabled="capturing" @click="captureCurrentPage">
              <RefreshCw v-if="screenshot" class="size-4" />
              <Camera v-else class="size-4" />
              {{
                capturing
                  ? t('feedback.screenshot.capturing')
                  : screenshot
                    ? t('feedback.screenshot.retake')
                    : t('feedback.screenshot.capture')
              }}
            </Button>
          </div>

          <div
            v-if="screenshot && screenshotUrl"
            class="mt-4 overflow-hidden rounded-lg border bg-background"
          >
            <img
              :src="screenshotUrl"
              :alt="t('feedback.screenshot.previewAlt')"
              class="max-h-72 w-full object-contain"
            />
            <div
              class="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground"
            >
              <span>{{
                t('feedback.screenshot.metadata', {
                  width: screenshot.width,
                  height: screenshot.height,
                  size: fileSize(screenshot.blob.size)
                })
              }}</span>
              <Button type="button" variant="ghost" size="sm" @click="removeScreenshot">
                <Trash2 class="size-3.5" />{{ t('feedback.screenshot.remove') }}
              </Button>
            </div>
          </div>
          <div
            v-else
            class="mt-4 flex min-h-24 items-center justify-center rounded-lg border border-dashed text-muted-foreground"
          >
            <ImageOff class="size-5" />
          </div>
        </section>

        <section
          class="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30"
        >
          <h3 class="font-medium text-amber-950 dark:text-amber-100">{{ t('feedback.privacy.title') }}</h3>
          <p class="mt-1 text-xs leading-5 text-amber-900 dark:text-amber-200">
            {{ t('feedback.privacy.description') }}
          </p>
          <label class="mt-3 flex items-start gap-2 text-xs text-amber-950 dark:text-amber-100">
            <input v-model="acknowledged" type="checkbox" class="mt-0.5 size-4 rounded border-input" />
            <span>{{ t('feedback.privacy.acknowledge') }}</span>
          </label>
        </section>

        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      </form>

      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" :disabled="capturing || openingGitHub" @click="updateOpen(false)">
            {{ t('common.actions.cancel') }}
          </Button>
          <Button :disabled="!canOpenGitHub" @click="openGitHubIssue">
            <ExternalLink class="size-4" />
            {{ openingGitHub ? t('feedback.actions.opening') : t('feedback.actions.openGitHub') }}
          </Button>
        </div>
      </template>
    </ModalDialog>
  </div>
</template>
