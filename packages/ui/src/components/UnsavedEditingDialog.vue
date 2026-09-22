<script setup lang="ts">
import type { UnsavedEditingService } from '../lib/unsaved-editing';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import ModalDialog from './ui/ModalDialog.vue';
const props = defineProps<{ service: UnsavedEditingService }>();
const { t } = useUiI18n();
</script>

<template>
  <ModalDialog
    :open="props.service.confirmationOpen.value"
    :title="t('shell.editing.title')"
    :description="t('shell.editing.description')"
    size="sm"
    @update:open="
      (open) => {
        if (!open) props.service.answer(false);
      }
    "
  >
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" @click="props.service.answer(false)">{{
          t('shell.editing.continue')
        }}</Button>
        <Button variant="destructive" @click="props.service.answer(true)">{{
          t('shell.editing.discard')
        }}</Button>
      </div>
    </template>
  </ModalDialog>
</template>
