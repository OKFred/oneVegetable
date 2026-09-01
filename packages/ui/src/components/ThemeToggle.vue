<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Moon, Sun, SunMoon } from '@lucide/vue';

import type { AppTheme } from '@one-vegetable/core';

import Button from './ui/Button.vue';
import { useAppPreferences } from '../lib/preferences';

interface ThemeOption {
  value: AppTheme;
  label: string;
  icon: Component;
}

const options: ThemeOption[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: SunMoon }
];
const fallbackOption: ThemeOption = options[2] ?? { value: 'system', label: '跟随系统', icon: SunMoon };
const { theme } = useAppPreferences();
const currentIndex = computed(() =>
  Math.max(
    0,
    options.findIndex((option) => option.value === theme.value)
  )
);
const currentOption = computed(() => options[currentIndex.value] ?? fallbackOption);
const nextOption = computed(() => options[(currentIndex.value + 1) % options.length] ?? fallbackOption);
const accessibleLabel = computed(
  () => `界面主题：${currentOption.value.label}；点击切换为${nextOption.value.label}`
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
