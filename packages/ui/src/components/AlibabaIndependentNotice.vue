<script setup lang="ts">
import { ExternalLink, Info } from '@lucide/vue';

import { useUiI18n } from '../i18n';

const ALIBABA_RULES_URL = 'https://rulechannel.alibaba.com/icbu';
const { t } = useUiI18n();
</script>

<template>
  <aside
    class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100"
    role="note"
  >
    <Info class="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
    <div class="min-w-0">
      <p class="font-medium">{{ t('auth.alibabaIndependentNotice.title') }}</p>
      <p class="mt-1 text-xs leading-5 text-amber-900/80 dark:text-amber-100/75">
        {{ t('auth.alibabaIndependentNotice.description') }}
      </p>
      <a
        :href="ALIBABA_RULES_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs font-medium underline decoration-amber-500/60 underline-offset-4 transition-colors hover:text-amber-700 dark:hover:text-amber-200"
      >
        {{ t('auth.alibabaIndependentNotice.rulesLink') }}
        <ExternalLink class="size-3.5" aria-hidden="true" />
      </a>
    </div>
  </aside>
</template>
