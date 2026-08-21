<script setup lang="ts">
import { Save, Send } from '@lucide/vue';

import Button from './ui/Button.vue';

withDefaults(
  defineProps<{
    editing: boolean;
    quick?: boolean;
    submitPending: boolean;
    schemaSafe: boolean;
    blockingCount: number;
    advisoryCount: number;
    publishDisabled: boolean;
    draftDisabled: boolean;
    platformDraftId?: string | null;
    publishDisabledReason?: string;
    draftDisabledReason?: string;
  }>(),
  {
    quick: false,
    platformDraftId: null,
    publishDisabledReason: '',
    draftDisabledReason: ''
  }
);

const emit = defineEmits<{ submit: [draft: boolean] }>();
</script>

<template>
  <div
    class="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 py-4 backdrop-blur"
  >
    <div class="min-w-0 text-xs text-muted-foreground">
      <p v-if="platformDraftId">
        平台草稿 {{ platformDraftId }} 已创建；后续修改自动保存在本机，不会重复创建。
      </p>
      <p v-else-if="blockingCount && quick">
        当前有 {{ blockingCount }} 个 Schema 问题，但仍可尝试保存平台草稿。
      </p>
      <p v-else>{{ advisoryCount }} 条非阻断建议不会禁用提交。</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button
        v-if="!editing"
        :variant="quick ? 'default' : 'outline'"
        :disabled="submitPending || draftDisabled || !schemaSafe || Boolean(platformDraftId)"
        :title="draftDisabledReason"
        @click="emit('submit', true)"
      >
        <Save class="size-4" />
        {{ platformDraftId ? '平台草稿已创建' : '保存平台草稿' }}
      </Button>
      <Button
        :variant="quick && !editing ? 'outline' : 'default'"
        :disabled="submitPending || publishDisabled || blockingCount > 0 || !schemaSafe"
        :title="publishDisabledReason"
        @click="emit('submit', false)"
      >
        <Send class="size-4" />{{ editing ? '更新商品' : '直接发布' }} · {{ advisoryCount }} 条建议
      </Button>
    </div>
  </div>
</template>
