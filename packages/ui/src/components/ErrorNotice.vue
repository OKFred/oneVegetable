<script setup lang="ts">
import { computed, ref } from 'vue';
import { AlertCircle, Check, Clipboard, Download } from '@lucide/vue';

import { sanitizeDiagnosticMessage } from '@one-vegetable/core/diagnostics';
import { describeUserVisibleError } from '@one-vegetable/core/errors';
import { APP_VERSION } from '@one-vegetable/core/version';

import type { DiagnosticsSnapshot } from '@one-vegetable/core';

import Button from './ui/Button.vue';
import { useServices } from '../lib/services';

const props = withDefaults(
  defineProps<{
    error: unknown;
    fallback?: string;
    compact?: boolean;
  }>(),
  {
    fallback: '操作失败',
    compact: false
  }
);

const { gateway, mode } = useServices();
const details = computed(() => describeUserVisibleError(props.error, props.fallback));
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
    exportFeedback.value = '复制失败，请手工选中 requestId。';
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
  exportFeedback.value = matchingEntries.length > 0 ? '已导出匹配的脱敏诊断。' : '已导出脱敏错误摘要。';
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
        <p class="break-words font-medium">{{ details.message }}</p>
        <p v-if="details.code" class="mt-1 text-xs opacity-80">错误码：{{ details.code }}</p>
        <div v-if="details.requestId" class="mt-2 flex flex-wrap items-center gap-2">
          <code class="break-all rounded bg-background/70 px-2 py-1 text-[11px] text-foreground">
            requestId: {{ details.requestId }}
          </code>
          <Button type="button" size="sm" variant="outline" class="h-7 gap-1" @click="copyRequestId">
            <Check v-if="copied" class="size-3.5" aria-hidden="true" />
            <Clipboard v-else class="size-3.5" aria-hidden="true" />
            {{ copied ? '已复制' : '复制 requestId' }}
          </Button>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="h-7 gap-1"
            :disabled="exporting"
            @click="exportRedactedDiagnostics"
          >
            <Download class="size-3.5" aria-hidden="true" />
            {{ exporting ? '正在整理…' : '导出脱敏诊断' }}
          </Button>
          <span v-if="exportFeedback" role="status" class="text-xs text-muted-foreground">
            {{ exportFeedback }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
