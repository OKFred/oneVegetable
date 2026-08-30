<script setup lang="ts">
import { computed } from 'vue';
import { ExternalLink } from '@lucide/vue';

const props = defineProps<{ productId: string }>();

const officialEditorUrl = computed(() => {
  if (!/^\d+$/u.test(props.productId)) return null;
  const url = new URL('https://post.alibaba.com/product/publish.htm');
  url.searchParams.set('itemId', props.productId);
  url.searchParams.set('pubAction', 'draft');
  return url.href;
});
</script>

<template>
  <div
    class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4"
  >
    <div class="min-w-0">
      <p class="font-medium">平台草稿 {{ productId }} 已创建</p>
      <p class="mt-1 text-xs text-muted-foreground">
        本应用会继续自动保存本地修改；Alibaba OpenAPI 暂无覆盖保存既有平台草稿的接口。
      </p>
    </div>
    <a
      v-if="officialEditorUrl"
      :href="officialEditorUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      在国际站继续编辑 <ExternalLink class="size-4" />
    </a>
  </div>
</template>
