<script setup lang="ts">
import { computed } from 'vue';
import { Save, Send } from '@lucide/vue';

import ActionTooltip from './ActionTooltip.vue';
import Button from './ui/Button.vue';

const props = withDefaults(
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
const draftActionDisabled = computed(
  () => props.submitPending || props.draftDisabled || !props.schemaSafe || Boolean(props.platformDraftId)
);
const publishActionDisabled = computed(
  () => props.submitPending || props.publishDisabled || props.blockingCount > 0 || !props.schemaSafe
);
const draftActionReason = computed(() => {
  if (props.submitPending) return '正在处理上一项商品操作';
  if (props.platformDraftId) return '平台草稿已创建，后续修改会继续保存在本机';
  if (!props.schemaSafe) return 'Schema XML 结构异常，请先修复后再保存';
  return props.draftDisabledReason || '当前不能保存平台草稿';
});
const publishActionReason = computed(() => {
  if (props.submitPending) return '正在处理上一项商品操作';
  if (!props.schemaSafe) return 'Schema XML 结构异常，请先修复后再提交';
  if (props.blockingCount > 0) return `仍有 ${props.blockingCount} 个最低发布条件需要补齐`;
  return props.publishDisabledReason || '当前不能提交商品';
});
</script>

<template>
  <div
    class="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 py-4 backdrop-blur"
  >
    <div class="min-w-0 text-xs text-muted-foreground">
      <p v-if="platformDraftId">后续修改自动保存在本机；写回平台请使用上方国际站编辑入口。</p>
      <p v-else-if="blockingCount && quick">
        当前有 {{ blockingCount }} 个最低发布条件未满足，但仍可保存平台草稿继续完善。
      </p>
      <p v-else>{{ advisoryCount }} 条预检提示不会禁用提交，最终以 Alibaba 返回为准。</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <ActionTooltip v-if="!editing" :disabled="draftActionDisabled" :reason="draftActionReason">
        <Button
          :variant="quick ? 'default' : 'outline'"
          :disabled="draftActionDisabled"
          @click="emit('submit', true)"
        >
          <Save class="size-4" />
          {{ platformDraftId ? '平台草稿已创建' : '保存平台草稿' }}
        </Button>
      </ActionTooltip>
      <ActionTooltip :disabled="publishActionDisabled" :reason="publishActionReason">
        <Button
          :variant="quick && !editing ? 'outline' : 'default'"
          :disabled="publishActionDisabled"
          @click="emit('submit', false)"
        >
          <Send class="size-4" />{{ editing ? '更新商品' : '直接发布' }} · {{ advisoryCount }} 条建议
        </Button>
      </ActionTooltip>
    </div>
  </div>
</template>
