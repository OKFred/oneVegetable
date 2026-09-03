<script setup lang="ts">
import { computed } from 'vue';
import { Check, Circle } from '@lucide/vue';

import type { AlibabaCredentialAcquisitionState } from '@one-vegetable/core';

import { useUiI18n } from '../i18n';

const props = defineProps<{ state: AlibabaCredentialAcquisitionState | null }>();

const { t } = useUiI18n();

const currentStep = computed(() => {
  const state = props.state;
  if (!state) return 0;
  if (state.status === 'prerequisite-required') {
    if (
      state.reasonCode === 'developer-registration-required' ||
      state.reasonCode === 'developer-registration-rejected'
    ) {
      return 0;
    }
    if (state.reasonCode === 'developer-registration-under-review') return 1;
    return 2;
  }
  return 3;
});

const completedAll = computed(() => props.state?.status === 'completed');
const steps = computed(() => [
  t('admin.alibabaPrerequisite.steps.registration'),
  t('admin.alibabaPrerequisite.steps.review'),
  t('admin.alibabaPrerequisite.steps.application'),
  t('admin.alibabaPrerequisite.steps.authorization')
]);
</script>

<template>
  <ol class="grid grid-cols-2 gap-2 sm:grid-cols-4" :aria-label="t('admin.alibabaPrerequisite.steps.label')">
    <li
      v-for="(label, index) in steps"
      :key="label"
      class="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors"
      :class="[
        completedAll || index < currentStep
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100'
          : index === currentStep
            ? 'border-primary/50 bg-primary/10 text-foreground'
            : 'bg-muted/25 text-muted-foreground'
      ]"
      :aria-current="!completedAll && index === currentStep ? 'step' : undefined"
    >
      <span
        class="grid size-5 shrink-0 place-items-center rounded-full border"
        :class="completedAll || index < currentStep ? 'border-emerald-500 bg-emerald-500 text-white' : ''"
      >
        <Check v-if="completedAll || index < currentStep" class="size-3" aria-hidden="true" />
        <Circle v-else class="size-2 fill-current" aria-hidden="true" />
      </span>
      <span class="min-w-0 leading-4">{{ index + 1 }}. {{ label }}</span>
    </li>
  </ol>
</template>
