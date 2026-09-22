<script setup lang="ts">
import { Info } from '@lucide/vue';
import { useUiI18n } from '../i18n';
import type { PlatformReadbackNoticeKind } from '../lib/platform-readback-notice';

defineProps<{ kind: PlatformReadbackNoticeKind | null }>();
const { t } = useUiI18n();
</script>

<template>
  <aside
    v-if="kind"
    :role="kind === 'inventory' ? 'note' : 'status'"
    data-testid="platform-readback-notice"
    class="flex items-start gap-2 whitespace-normal rounded-md border border-border bg-muted/50 p-3 text-xs leading-relaxed text-foreground"
  >
    <Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <p>{{ t(`common.platformReadback.${kind}`) }}</p>
  </aside>
</template>
