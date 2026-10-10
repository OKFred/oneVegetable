<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  Camera,
  Clipboard,
  ExternalLink,
  ImageOff,
  MessageCircleQuestion,
  RefreshCw,
  Trash2
} from '@lucide/vue';
import { toast } from 'vue-sonner';

import { APP_VERSION } from '@one-vegetable/core/version';

import { useUiI18n } from '../i18n';
import { buildGitHubFeedbackUrl, GITHUB_FEEDBACK_URL, type FeedbackEnvironmentInput } from '../lib/feedback';
import { captureFeedbackScreenshot, type FeedbackScreenshot } from '../lib/feedback-screenshot';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
import Tooltip from './ui/Tooltip.vue';

const props = defineProps<{ mode: 'mock' | 'extension' | 'bff' }>();
const { locale, t } = useUiI18n();
const open = ref(false);
const screenshot = ref<FeedbackScreenshot | null>(null);
const screenshotUrl = ref<string | null>(null);
const capturing = ref(false);
const copying = ref(false);
const error = ref<string | null>(null);
const issueUrl = computed(() =>
  open.value ? buildGitHubFeedbackUrl(currentEnvironment()) : GITHUB_FEEDBACK_URL
);

function openDialog(): void {
  error.value = null;
  open.value = true;
}

function updateOpen(nextOpen: boolean): void {
  if (capturing.value || copying.value) return;
  open.value = nextOpen;
  if (!nextOpen) resetDraft();
}

async function captureCurrentPage(): Promise<void> {
  if (capturing.value || copying.value) return;
  const root = globalThis.document.querySelector<HTMLElement>('[data-feedback-capture-root]');
  if (!root) {
    error.value = t('feedback.screenshot.failed');
    return;
  }
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

async function copyCurrentScreenshot(): Promise<void> {
  if (capturing.value || copying.value) return;
  const currentScreenshot = screenshot.value;
  if (!currentScreenshot) return;
  copying.value = true;
  error.value = null;
  try {
    const copied = await copyScreenshot(currentScreenshot.blob);
    if (copied) toast.success(t('feedback.status.clipboardReady'));
    else {
      downloadScreenshot(currentScreenshot);
      toast.warning(t('feedback.status.downloaded'));
    }
  } catch {
    error.value = t('feedback.screenshot.copyFailed');
  } finally {
    copying.value = false;
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

function replaceScreenshot(value: FeedbackScreenshot): void {
  releaseScreenshot();
  screenshot.value = value;
  screenshotUrl.value = URL.createObjectURL(value.blob);
}

function removeScreenshot(): void {
  if (capturing.value || copying.value) return;
  releaseScreenshot();
}

function releaseScreenshot(): void {
  if (screenshotUrl.value) URL.revokeObjectURL(screenshotUrl.value);
  screenshotUrl.value = null;
  screenshot.value = null;
}

function resetDraft(): void {
  releaseScreenshot();
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
      <div class="space-y-5">
        <section class="rounded-lg border bg-muted/30 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-medium">{{ t('feedback.screenshot.title') }}</h3>
              <p class="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                {{ t('feedback.screenshot.description') }}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              :disabled="capturing || copying"
              @click="captureCurrentPage"
            >
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                :disabled="capturing || copying"
                @click="removeScreenshot"
              >
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
        </section>

        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      </div>

      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <Button variant="outline" :disabled="capturing || copying" @click="updateOpen(false)">
            {{ t('common.actions.close') }}
          </Button>
          <Button :disabled="!screenshot || capturing || copying" @click="copyCurrentScreenshot">
            <Clipboard class="size-4" />
            {{ t(copying ? 'feedback.actions.copying' : 'feedback.actions.copy') }}
          </Button>
          <a
            :href="issueUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink class="size-4" />{{ t('feedback.actions.openGitHub') }}
          </a>
        </div>
      </template>
    </ModalDialog>
  </div>
</template>
