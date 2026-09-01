<script setup lang="ts">
import { computed, ref } from 'vue';
import { AlertCircle, Check, Clipboard, Download, Settings } from '@lucide/vue';

import { sanitizeDiagnosticMessage } from '@one-vegetable/core/diagnostics';
import { describeUserVisibleError, splitUserVisibleErrorMessages } from '@one-vegetable/core/errors';
import { APP_VERSION } from '@one-vegetable/core/version';

import type { DiagnosticsSnapshot } from '@one-vegetable/core';

import Button from './ui/Button.vue';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';

const { t } = useUiI18n();

const props = withDefaults(
  defineProps<{
    error: unknown;
    fallback?: string;
    compact?: boolean;
  }>(),
  {
    fallback: '',
    compact: false
  }
);

const { gateway, mode } = useServices();
const details = computed(() =>
  describeUserVisibleError(props.error, props.fallback || t('common.error.fallback'))
);
const messageParts = computed(() => splitUserVisibleErrorMessages(details.value.message));
const credentialSettingsRequired = computed(
  () => mode === 'extension' && details.value.code?.startsWith('CREDENTIAL_VAULT_') === true
);
const copied = ref(false);
const exporting = ref(false);
const exportFeedback = ref('');

async function copyRequestId(): Promise<void> {
  const requestId = details.value.requestId;
  if (!requestId) return;
  try {
    await globalThis.navigator.clipboard.writeText(requestId);
    exportFeedback.value = '';
    copied.value = true;
    globalThis.setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    exportFeedback.value = t('common.error.copyFailed');
  }
}

async function exportRedactedDiagnostics(): Promise<void> {
  exporting.value = true;
  exportFeedback.value = '';
  let snapshot: DiagnosticsSnapshot | null = null;
  try {
    snapshot = await gateway.request('getDiagnostics', undefined);
  } catch {
    // The current redacted error remains exportable even if diagnostics are unavailable.
  }

  const requestId = details.value.requestId;
  const matchingEntries = requestId
    ? (snapshot?.entries
        .filter((entry) => entry.requestId === requestId)
        .map((entry) => ({
          ...entry,
          errorMessage: entry.errorMessage ? sanitizeDiagnosticMessage(entry.errorMessage) : null
        })) ?? [])
    : [];
  downloadJson(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      applicationVersion: APP_VERSION,
      runtimeMode: mode,
      error: {
        code: details.value.code,
        message: sanitizeDiagnosticMessage(details.value.message),
        requestId,
        traceId: details.value.traceId,
        retryable: details.value.retryable
      },
      matchingEntries
    },
    `one-vegetable-error-${requestId?.slice(0, 8) ?? 'local'}-${new Date().toISOString().slice(0, 10)}.json`
  );
  exporting.value = false;
  exportFeedback.value =
    matchingEntries.length > 0 ? t('common.error.diagnosticsMatched') : t('common.error.diagnosticsSummary');
}

function downloadJson(value: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div
    role="alert"
    :class="[
      'rounded-lg border border-destructive/30 bg-destructive/5 text-destructive',
      compact ? 'p-3 text-xs' : 'p-4 text-sm'
    ]"
  >
    <div class="flex items-start gap-2">
      <AlertCircle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p v-if="messageParts.length === 1" class="break-words font-medium">{{ messageParts[0] }}</p>
        <div v-else>
          <p class="font-medium">
            {{ t('common.error.multipleReasons', { count: messageParts.length }) }}
          </p>
          <ul class="mt-1 list-disc space-y-1 pl-5">
            <li v-for="message in messageParts" :key="message" class="break-words">{{ message }}</li>
          </ul>
        </div>
        <p v-if="details.code" class="mt-1 text-xs opacity-80">
          {{ t('common.error.code', { code: details.code }) }}
        </p>
        <div v-if="details.requestId || details.traceId" class="mt-2 flex flex-wrap items-center gap-2">
          <code
            v-if="details.requestId"
            class="break-all rounded bg-background/70 px-2 py-1 text-[11px] text-foreground"
          >
            requestId: {{ details.requestId }}
          </code>
          <code
            v-if="details.traceId"
            class="break-all rounded bg-background/70 px-2 py-1 text-[11px] text-foreground"
          >
            traceId: {{ details.traceId }}
          </code>
          <Button
            v-if="details.requestId"
            type="button"
            size="sm"
            variant="outline"
            class="h-7 gap-1"
            @click="copyRequestId"
          >
            <Check v-if="copied" class="size-3.5" aria-hidden="true" />
            <Clipboard v-else class="size-3.5" aria-hidden="true" />
            {{ copied ? t('common.actions.copied') : t('common.error.copyRequestId') }}
          </Button>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <a
            v-if="credentialSettingsRequired"
            href="#/settings"
            class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Settings class="size-3.5" aria-hidden="true" />{{ t('common.error.configureCredentials') }}
          </a>
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="h-7 gap-1"
            :disabled="exporting"
            @click="exportRedactedDiagnostics"
          >
            <Download class="size-3.5" aria-hidden="true" />
            {{ exporting ? t('common.error.preparingDiagnostics') : t('common.error.exportDiagnostics') }}
          </Button>
          <span v-if="exportFeedback" role="status" class="text-xs text-muted-foreground">
            {{ exportFeedback }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
