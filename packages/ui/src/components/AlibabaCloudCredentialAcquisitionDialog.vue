<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  LoaderCircle,
  Puzzle,
  ShieldCheck
} from '@lucide/vue';

import type {
  AlibabaCredentialAcquisitionExtensionFallbackReason,
  AlibabaCredentialAcquisitionState
} from '@one-vegetable/core';

import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import AlibabaCredentialAcquisitionSteps from './AlibabaCredentialAcquisitionSteps.vue';
import AlibabaCredentialPrerequisiteGuide from './AlibabaCredentialPrerequisiteGuide.vue';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  completed: [];
}>();

const { control } = useServices();
const { t } = useUiI18n();
const account = ref('');
const password = ref('');
const callbackUrl = ref('');
const state = ref<AlibabaCredentialAcquisitionState | null>(null);
const manualExtensionGuide = ref(false);
const busy = ref(false);
const error = ref<unknown>(null);
let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

type DialogViewState =
  AlibabaCredentialAcquisitionState | { status: 'form' } | { status: 'manual-extension' };

const viewState = computed<DialogViewState>(() => {
  if (manualExtensionGuide.value) return { status: 'manual-extension' };
  return state.value ?? { status: 'form' };
});

const activeJobId = computed(() => {
  const current = state.value;
  return current?.status === 'running' ||
    current?.status === 'selection-required' ||
    current?.status === 'callback-confirmation-required'
    ? current.jobId
    : null;
});

async function start(): Promise<void> {
  if (!control?.startAlibabaCredentialAcquisition || !account.value.trim() || !password.value) return;
  busy.value = true;
  error.value = null;
  state.value = null;
  try {
    const next = await control.startAlibabaCredentialAcquisition({
      account: account.value.trim(),
      password: password.value,
      callbackUrl: callbackUrl.value.trim() || null
    });
    acceptState(next);
  } catch (cause: unknown) {
    error.value = userError(cause, t('admin.cloudAcquisition.errors.start'));
  } finally {
    account.value = '';
    password.value = '';
    busy.value = false;
  }
}

async function selectApplication(applicationId: string): Promise<void> {
  const jobId = activeJobId.value;
  if (!control?.continueAlibabaCredentialAcquisition || !jobId) return;
  await continueJob(jobId, { type: 'select-application', applicationId });
}

async function confirmCallback(confirmed: boolean): Promise<void> {
  const jobId = activeJobId.value;
  if (!control?.continueAlibabaCredentialAcquisition || !jobId) return;
  await continueJob(jobId, { type: 'confirm-callback-change', confirmed });
}

async function continueJob(
  jobId: string,
  command:
    | { type: 'select-application'; applicationId: string }
    | { type: 'confirm-callback-change'; confirmed: boolean }
): Promise<void> {
  if (!control?.continueAlibabaCredentialAcquisition) return;
  busy.value = true;
  error.value = null;
  try {
    const next = await control.continueAlibabaCredentialAcquisition(jobId, command);
    acceptState(next);
  } catch (cause: unknown) {
    error.value = userError(cause, t('admin.cloudAcquisition.errors.continue'));
  } finally {
    busy.value = false;
  }
}

function acceptState(next: AlibabaCredentialAcquisitionState): void {
  state.value = next;
  clearPoll();
  if (next.status === 'running') schedulePoll(next.jobId);
  if (next.status === 'completed') emit('completed');
}

function schedulePoll(jobId: string): void {
  clearPoll();
  pollTimer = globalThis.setTimeout(() => void poll(jobId), 1_500);
}

async function poll(jobId: string): Promise<void> {
  if (!control?.alibabaCredentialAcquisitionStatus || !props.open) return;
  try {
    const next = await control.alibabaCredentialAcquisitionStatus(jobId);
    acceptState(next);
  } catch (cause: unknown) {
    error.value = userError(cause, t('admin.cloudAcquisition.errors.status'));
  }
}

async function close(): Promise<void> {
  clearPoll();
  const jobId = activeJobId.value;
  emit('update:open', false);
  state.value = null;
  error.value = null;
  account.value = '';
  password.value = '';
  callbackUrl.value = '';
  manualExtensionGuide.value = false;
  if (control?.cancelAlibabaCredentialAcquisition && jobId) {
    await control.cancelAlibabaCredentialAcquisition(jobId).catch(() => undefined);
  }
}

function clearPoll(): void {
  if (pollTimer !== null) globalThis.clearTimeout(pollTimer);
  pollTimer = null;
}

function fallbackMessage(reason: AlibabaCredentialAcquisitionExtensionFallbackReason): string {
  const messages: Record<AlibabaCredentialAcquisitionExtensionFallbackReason, string> = {
    'browser-unavailable': t('admin.cloudAcquisition.fallback.browserUnavailable'),
    'browser-quota-exhausted': t('admin.cloudAcquisition.fallback.browserQuotaExhausted'),
    'bot-rejected': t('admin.cloudAcquisition.fallback.botRejected'),
    captcha: t('admin.cloudAcquisition.fallback.captcha'),
    slider: t('admin.cloudAcquisition.fallback.slider'),
    mfa: t('admin.cloudAcquisition.fallback.mfa'),
    'secret-verification': t('admin.cloudAcquisition.fallback.secretVerification'),
    'automation-layout-unsupported': t('admin.cloudAcquisition.fallback.layoutUnsupported'),
    'session-expired': t('admin.cloudAcquisition.fallback.sessionExpired')
  };
  return messages[reason];
}

function userError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback);
}

function openChromeStore(): void {
  globalThis.open(
    'https://chromewebstore.google.com/detail/aepfdoldflokikbbcpnfifkacpfakmjc',
    '_blank',
    'noopener,noreferrer'
  );
}

function openAlibabaApplicationCenter(): void {
  globalThis.open('https://i.alibaba.com/explore/open-api', '_blank', 'noopener,noreferrer');
}

onBeforeUnmount(clearPoll);
</script>

<template>
  <ModalDialog
    :open="open"
    :title="t('admin.cloudAcquisition.title')"
    :description="t('admin.cloudAcquisition.description')"
    size="lg"
    @update:open="$event ? emit('update:open', true) : void close()"
  >
    <div class="space-y-5">
      <AlibabaCredentialAcquisitionSteps :state="state" />

      <ErrorNotice v-if="error" :error="error" :fallback="t('admin.cloudAcquisition.errors.acquisition')" />

      <form v-if="viewState.status === 'form'" class="space-y-4" @submit.prevent="start">
        <div
          class="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100"
        >
          <p class="flex items-center gap-2 font-medium">
            <ShieldCheck class="size-4" />{{ t('admin.cloudAcquisition.sensitiveTitle') }}
          </p>
          <p class="mt-1 leading-6">
            {{ t('admin.cloudAcquisition.sensitiveDescription') }}
          </p>
          <p class="mt-2 leading-6">
            {{ t('admin.cloudAcquisition.quotaNotice') }}
          </p>
        </div>

        <label class="grid gap-1.5 text-sm">
          <span class="font-medium">{{ t('admin.cloudAcquisition.account') }}</span>
          <Input v-model="account" autocomplete="username" maxlength="512" required />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span class="font-medium">{{ t('admin.cloudAcquisition.password') }}</span>
          <Input
            v-model="password"
            type="password"
            autocomplete="current-password"
            maxlength="1024"
            required
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span class="font-medium">{{ t('admin.cloudAcquisition.callback') }}</span>
          <Input
            v-model="callbackUrl"
            type="url"
            :placeholder="t('admin.cloudAcquisition.callbackPlaceholder')"
          />
          <span class="text-xs text-muted-foreground">{{ t('admin.cloudAcquisition.callbackNotice') }}</span>
        </label>

        <div class="flex flex-wrap justify-between gap-3 border-t pt-4">
          <Button type="button" variant="outline" @click="close">{{
            t('admin.cloudAcquisition.cancel')
          }}</Button>
          <div class="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" @click="manualExtensionGuide = true">
              <Puzzle class="size-4" />{{ t('admin.cloudAcquisition.useExtension') }}
            </Button>
            <Button type="submit" :disabled="busy || !account.trim() || !password">
              <LoaderCircle v-if="busy" class="size-4 animate-spin" />
              <Cloud v-else class="size-4" />
              {{ busy ? t('admin.cloudAcquisition.connecting') : t('admin.cloudAcquisition.automatic') }}
            </Button>
          </div>
        </div>
      </form>

      <div v-else-if="viewState.status === 'running'" class="py-10 text-center">
        <LoaderCircle class="mx-auto size-8 animate-spin text-primary" />
        <p class="mt-3 font-medium">{{ t('admin.cloudAcquisition.runningTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('admin.cloudAcquisition.runningDescription') }}</p>
      </div>

      <div v-else-if="viewState.status === 'prerequisite-required'" class="space-y-4">
        <AlibabaCredentialPrerequisiteGuide
          :state="viewState"
          :busy="busy"
          :can-recheck="false"
          @open-page="openAlibabaApplicationCenter"
        />
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" @click="state = null">{{ t('admin.cloudAcquisition.restart') }}</Button>
          <Button @click="manualExtensionGuide = true">
            <Puzzle class="size-4" />{{ t('admin.cloudAcquisition.useExtension') }}
          </Button>
        </div>
      </div>

      <div v-else-if="viewState.status === 'selection-required'" class="space-y-3">
        <div>
          <h3 class="font-semibold">{{ t('admin.cloudAcquisition.selectApplication') }}</h3>
          <p class="text-sm text-muted-foreground">
            {{ t('admin.cloudAcquisition.selectApplicationDescription') }}
          </p>
        </div>
        <button
          v-for="application in viewState.applications"
          :key="application.applicationId"
          type="button"
          class="flex w-full items-center justify-between rounded-lg border bg-card p-4 text-left transition hover:border-primary hover:bg-accent disabled:opacity-60"
          :disabled="busy"
          @click="selectApplication(application.applicationId)"
        >
          <span>
            <span class="block font-medium">{{ application.appName }}</span>
            <span class="mt-1 block text-xs text-muted-foreground">
              {{
                application.source === 'legacy-crosstrade'
                  ? t('admin.cloudAcquisition.legacyApplicationCenter')
                  : t('admin.cloudAcquisition.applicationCenter')
              }}
              · {{ application.status || t('admin.cloudAcquisition.unknownStatus') }}
            </span>
          </span>
          <code class="rounded bg-muted px-2 py-1 text-xs">••••{{ application.appKeySuffix }}</code>
        </button>
      </div>

      <div v-else-if="viewState.status === 'callback-confirmation-required'" class="space-y-4">
        <div
          class="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
        >
          <p class="flex items-center gap-2 font-medium">
            <AlertTriangle class="size-4" />{{ t('admin.cloudAcquisition.callbackConfirmation') }}
          </p>
          <dl class="mt-3 grid gap-3 text-sm">
            <div>
              <dt class="text-muted-foreground">{{ t('admin.cloudAcquisition.currentUrl') }}</dt>
              <dd class="break-all font-mono text-xs">{{ viewState.currentUrl }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground">{{ t('admin.cloudAcquisition.newUrl') }}</dt>
              <dd class="break-all font-mono text-xs">{{ viewState.requestedUrl }}</dd>
            </div>
          </dl>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="confirmCallback(false)">
            {{ t('admin.cloudAcquisition.keepUrl') }}
          </Button>
          <Button :disabled="busy" @click="confirmCallback(true)">
            {{ t('admin.cloudAcquisition.confirmUrl') }}
          </Button>
        </div>
      </div>

      <div
        v-else-if="viewState.status === 'manual-extension' || viewState.status === 'extension-required'"
        class="space-y-4"
      >
        <div class="rounded-lg border p-5">
          <p class="flex items-center gap-2 font-semibold">
            <Puzzle class="size-5" />{{ t('admin.cloudAcquisition.extensionTitle') }}
          </p>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">
            <template v-if="viewState.status === 'extension-required'">
              {{ fallbackMessage(viewState.reasonCode) }}
            </template>
            <template v-else>{{ t('admin.cloudAcquisition.extensionNoQuota') }}</template>
            {{ t('admin.cloudAcquisition.extensionDescription') }}
          </p>
        </div>
        <ol class="list-decimal space-y-2 pl-5 text-sm">
          <li>{{ t('admin.cloudAcquisition.extensionSteps.install') }}</li>
          <li>{{ t('admin.cloudAcquisition.extensionSteps.authorize') }}</li>
          <li>{{ t('admin.cloudAcquisition.extensionSteps.import') }}</li>
        </ol>
        <div class="flex flex-wrap justify-end gap-2">
          <Button
            v-if="viewState.status === 'manual-extension'"
            variant="outline"
            @click="manualExtensionGuide = false"
            >{{ t('admin.cloudAcquisition.back') }}</Button
          >
          <Button v-else variant="outline" @click="close">{{ t('admin.cloudAcquisition.close') }}</Button>
          <Button @click="openChromeStore">
            {{ t('admin.cloudAcquisition.openStore') }}<ExternalLink class="size-4" />
          </Button>
        </div>
      </div>

      <div v-else-if="viewState.status === 'completed'" class="py-6 text-center">
        <CheckCircle2 class="mx-auto size-10 text-emerald-600" />
        <h3 class="mt-3 text-lg font-semibold">{{ t('admin.cloudAcquisition.completedTitle') }}</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          {{
            t('admin.cloudAcquisition.completedDescription', {
              appName: viewState.credential.appName,
              suffix: viewState.credential.appKeySuffix
            })
          }}
        </p>
        <Button class="mt-5" @click="close">{{ t('admin.cloudAcquisition.done') }}</Button>
      </div>

      <div v-else-if="viewState.status === 'failed'" class="space-y-4 py-6 text-center">
        <AlertTriangle class="mx-auto size-9 text-destructive" />
        <h3 class="font-semibold">{{ t('admin.cloudAcquisition.failedTitle') }}</h3>
        <p class="text-sm text-muted-foreground">{{ viewState.error.message }}</p>
        <Button variant="outline" @click="state = null">{{ t('admin.cloudAcquisition.restart') }}</Button>
      </div>
    </div>
  </ModalDialog>
</template>
