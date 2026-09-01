<script setup lang="ts">
import { computed } from 'vue';
import { Save, Send } from '@lucide/vue';

import ActionTooltip from './ActionTooltip.vue';
import Button from './ui/Button.vue';
import { useUiI18n } from '../i18n';

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
const { t } = useUiI18n();
const draftActionDisabled = computed(
  () => props.submitPending || props.draftDisabled || !props.schemaSafe || Boolean(props.platformDraftId)
);
const publishActionDisabled = computed(
  () => props.submitPending || props.publishDisabled || props.blockingCount > 0 || !props.schemaSafe
);
const draftActionReason = computed(() => {
  if (props.submitPending) return t('products.submitBar.processing');
  if (props.platformDraftId) return t('products.submitBar.draftExists');
  if (!props.schemaSafe) return t('products.submitBar.schemaSaveBlocked');
  return props.draftDisabledReason || t('products.submitBar.draftUnavailable');
});
const publishActionReason = computed(() => {
  if (props.submitPending) return t('products.submitBar.processing');
  if (!props.schemaSafe) return t('products.submitBar.schemaSubmitBlocked');
  if (props.blockingCount > 0) {
    return t('products.submitBar.minimumMissing', { count: props.blockingCount });
  }
  return props.publishDisabledReason || t('products.submitBar.submitUnavailable');
});
</script>

<template>
  <div
    class="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 py-4 backdrop-blur"
  >
    <div class="min-w-0 text-xs text-muted-foreground">
      <p v-if="platformDraftId">{{ t('products.submitBar.localAfterDraft') }}</p>
      <p v-else-if="blockingCount && quick">
        {{ t('products.submitBar.quickBlocked', { count: blockingCount }) }}
      </p>
      <p v-else>{{ t('products.submitBar.advisories', { count: advisoryCount }) }}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <ActionTooltip v-if="!editing" :disabled="draftActionDisabled" :reason="draftActionReason">
        <Button
          :variant="quick ? 'default' : 'outline'"
          :disabled="draftActionDisabled"
          @click="emit('submit', true)"
        >
          <Save class="size-4" />
          {{
            t(platformDraftId ? 'products.editor.platformDraftCreated' : 'products.editor.savePlatformDraft')
          }}
        </Button>
      </ActionTooltip>
      <ActionTooltip :disabled="publishActionDisabled" :reason="publishActionReason">
        <Button
          :variant="quick && !editing ? 'outline' : 'default'"
          :disabled="publishActionDisabled"
          @click="emit('submit', false)"
        >
          <Send class="size-4" />{{
            t(editing ? 'products.editor.update' : 'products.editor.publishDirectly')
          }}
          · {{ t('products.common.suggestionCount', { count: advisoryCount }) }}
        </Button>
      </ActionTooltip>
    </div>
  </div>
</template>
