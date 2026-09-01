<script setup lang="ts">
import { watch } from 'vue';
import { ExternalLink, Sprout } from '@lucide/vue';
import { APP_VERSION } from '@one-vegetable/core/version';
import { LanguageToggle, useUiI18n } from '@one-vegetable/ui';

defineProps<{ openDashboard: () => Promise<void> }>();
const { locale, t } = useUiI18n();

watch(
  locale,
  () => {
    globalThis.document.title = t('shell.brand');
  },
  { immediate: true }
);
</script>

<template>
  <main class="w-80 bg-slate-950 p-4 text-slate-100">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <span class="flex size-10 items-center justify-center rounded-lg bg-emerald-500 text-slate-950"
          ><Sprout class="size-5"
        /></span>
        <div>
          <h1 class="font-semibold">{{ t('shell.brand') }}</h1>
          <p class="text-xs text-slate-400">Manifest V3 · v{{ APP_VERSION }}</p>
        </div>
      </div>
      <LanguageToggle class="text-slate-100 hover:bg-slate-800" />
    </div>
    <button
      class="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-emerald-500 text-sm font-medium text-slate-950 hover:bg-emerald-400"
      @click="openDashboard"
    >
      <ExternalLink class="size-4" />{{ t('shell.openWorkspace') }}
    </button>
    <p class="mt-3 text-[11px] leading-4 text-slate-400">
      {{ t('shell.popupDescription') }}
    </p>
  </main>
</template>
