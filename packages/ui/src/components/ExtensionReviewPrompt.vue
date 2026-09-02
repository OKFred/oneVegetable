<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ExternalLink, Star } from '@lucide/vue';

import type { ExtensionReviewPromptRepository } from '@one-vegetable/core';

import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';

const props = defineProps<{ repository: ExtensionReviewPromptRepository }>();
const { t } = useUiI18n();
const visible = ref(false);
const opening = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    visible.value = await props.repository.claimDuePrompt();
  } catch {
    visible.value = false;
  }
});

function dismiss(): void {
  if (opening.value) return;
  visible.value = false;
  error.value = '';
}

function handleOpenChange(open: boolean): void {
  if (!open) dismiss();
}

async function openStoreReview(): Promise<void> {
  if (opening.value) return;
  opening.value = true;
  error.value = '';
  try {
    await props.repository.openStoreReview();
    visible.value = false;
  } catch {
    error.value = t('reviewPrompt.openFailed');
  } finally {
    opening.value = false;
  }
}
</script>

<template>
  <ModalDialog
    :open="visible"
    :title="t('reviewPrompt.title')"
    :description="t('reviewPrompt.description')"
    :show-close="false"
    size="sm"
    @update:open="handleOpenChange"
  >
    <div data-testid="extension-review-prompt" class="flex gap-4 rounded-lg border bg-muted/35 p-4">
      <span
        class="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        aria-hidden="true"
      >
        <Star class="size-5" />
      </span>
      <p class="text-sm leading-6 text-muted-foreground">
        {{ t('reviewPrompt.notice') }}
      </p>
    </div>
    <p v-if="error" class="mt-3 text-sm text-destructive" role="alert">{{ error }}</p>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" :disabled="opening" @click="dismiss">
          {{ t('reviewPrompt.later') }}
        </Button>
        <Button :disabled="opening" @click="openStoreReview">
          <ExternalLink class="size-4" />
          {{ opening ? t('reviewPrompt.opening') : t('reviewPrompt.rate') }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
