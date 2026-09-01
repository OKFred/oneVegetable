<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Moon, Sun, SunMoon } from '@lucide/vue';

import type { AppTheme } from '@one-vegetable/core';

import Button from './ui/Button.vue';
import { useUiI18n } from '../i18n';
import { useAppPreferences } from '../lib/preferences';

interface ThemeOption {
  value: AppTheme;
  labelKey: string;
  icon: Component;
}

const options: ThemeOption[] = [
  { value: 'light', labelKey: 'common.theme.light', icon: Sun },
  { value: 'dark', labelKey: 'common.theme.dark', icon: Moon },
  { value: 'system', labelKey: 'common.theme.system', icon: SunMoon }
];
const fallbackOption: ThemeOption = options[2] ?? {
  value: 'system',
  labelKey: 'common.theme.system',
  icon: SunMoon
};
const { theme } = useAppPreferences();
const { t } = useUiI18n();
const currentIndex = computed(() =>
  Math.max(
    0,
    options.findIndex((option) => option.value === theme.value)
  )
);
const currentOption = computed(() => options[currentIndex.value] ?? fallbackOption);
const nextOption = computed(() => options[(currentIndex.value + 1) % options.length] ?? fallbackOption);
const accessibleLabel = computed(() =>
  t('common.theme.switch', {
    current: t(currentOption.value.labelKey),
    next: t(nextOption.value.labelKey)
  })
);

function cycleTheme(): void {
  theme.value = nextOption.value.value;
}
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    :aria-label="accessibleLabel"
    :title="accessibleLabel"
    data-testid="theme-toggle"
    @click="cycleTheme"
  >
    <component :is="currentOption.icon" class="size-4" aria-hidden="true" />
  </Button>
</template>
