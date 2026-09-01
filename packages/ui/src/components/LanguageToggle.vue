<script setup lang="ts">
import Button from './ui/Button.vue';
import { useUiI18n } from '../i18n';
import { useAppPreferences } from '../lib/preferences';

const { uiLocale } = useAppPreferences();
const { t } = useUiI18n();

function toggleLocale(): void {
  uiLocale.value = uiLocale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
}
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    class="font-semibold"
    :aria-label="
      uiLocale === 'zh-CN' ? t('common.language.switchToEnglish') : t('common.language.switchToChinese')
    "
    :title="
      uiLocale === 'zh-CN' ? t('common.language.switchToEnglish') : t('common.language.switchToChinese')
    "
    data-testid="language-toggle"
    @click="toggleLocale"
  >
    {{ uiLocale === 'zh-CN' ? t('common.language.shortEnglish') : t('common.language.shortChinese') }}
  </Button>
</template>
