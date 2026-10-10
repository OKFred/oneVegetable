<script setup lang="ts">
import { ref } from 'vue';
import type { ProductDescriptionTemplateLanguage } from '@one-vegetable/core';
import PageHeader from '../components/PageHeader.vue';
import ProductDescriptionTemplatePanel from '../components/ProductDescriptionTemplatePanel.vue';
import { useUiI18n } from '../i18n';
import { useAppPreferences } from '../lib/preferences';
import { useServices } from '../lib/services';
import { useUnsavedEditingService } from '../lib/unsaved-editing';

const { t } = useUiI18n();
const { mode } = useServices();
const { alibabaLanguage } = useAppPreferences();
const language = ref<ProductDescriptionTemplateLanguage>(alibabaLanguage.value);
const editing = useUnsavedEditingService();
function changeLanguage(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const next = select.value;
  select.value = language.value;
  if (next === 'zh_CN' || next === 'en_US')
    void (async () => {
      if (!editing || (await editing.confirmLeave())) language.value = next;
    })();
}
</script>

<template>
  <div class="space-y-5">
    <PageHeader
      :title="t('shell.navigation.templates')"
      :description="
        t(mode === 'extension' ? 'products.templates.localDescription' : 'products.templates.editDescription')
      "
    >
      <select
        :value="language"
        class="h-9 rounded-md border bg-background px-3 text-sm"
        :aria-label="t('products.templates.language')"
        @change="changeLanguage"
      >
        <option value="zh_CN">{{ t('settings.alibabaLanguage.chinese') }}</option>
        <option value="en_US">{{ t('settings.alibabaLanguage.english') }}</option>
      </select>
    </PageHeader>
    <ProductDescriptionTemplatePanel :language="language" current-html="" standalone />
  </div>
</template>
