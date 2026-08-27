<script setup lang="ts">
import { ExternalLink, Sprout } from '@lucide/vue';
import { APP_VERSION } from '@one-vegetable/core/version';

defineProps<{ openDashboard: () => Promise<void> }>();
</script>

<template>
  <main class="w-80 bg-slate-950 p-4 text-slate-100">
    <div class="flex items-center gap-3">
      <span class="flex size-10 items-center justify-center rounded-lg bg-emerald-500 text-slate-950"
        ><Sprout class="size-5"
      /></span>
      <div>
        <h1 class="font-semibold">一根青菜</h1>
        <p class="text-xs text-slate-400">Manifest V3 · v{{ APP_VERSION }}</p>
      </div>
    </div>
    <button
      class="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-emerald-500 text-sm font-medium text-slate-950 hover:bg-emerald-400"
      @click="openDashboard"
    >
      <ExternalLink class="size-4" />打开运营工作台
    </button>
    <p class="mt-3 text-[11px] leading-4 text-slate-400">
      开发模式由 WXT 自动重载；真实 API 请求由扩展 service worker 发起。
    </p>
  </main>
</template>
