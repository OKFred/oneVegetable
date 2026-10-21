<script setup lang="ts">
import { computed } from 'vue';
import applicationSetupImage from '../assets/onboarding/application-setup.webp';
import developerRegistrationImage from '../assets/onboarding/developer-registration.webp';
import oauthSecureImage from '../assets/onboarding/oauth-secure.webp';
import { useUiI18n } from '../i18n';
import AlibabaIndependentNotice from './AlibabaIndependentNotice.vue';

const { t } = useUiI18n();
const steps = computed(() => [
  { id: 'registration', image: developerRegistrationImage },
  { id: 'review', image: developerRegistrationImage },
  { id: 'application', image: applicationSetupImage },
  { id: 'authorization', image: oauthSecureImage }
]);
</script>

<template>
  <div class="space-y-4" data-testid="authorization-wizard-guide">
    <ol class="grid gap-3 sm:grid-cols-2" :aria-label="t('auth.onboarding.journey.label')">
      <li v-for="(step, index) in steps" :key="step.id" class="rounded-xl border bg-muted/20 p-4">
        <div class="flex items-center gap-3">
          <span
            class="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-foreground"
            aria-hidden="true"
            >{{ index + 1 }}</span
          >
          <h3 class="font-medium">{{ t(`auth.onboarding.journey.${step.id}.title`) }}</h3>
        </div>
        <img
          :src="step.image"
          :alt="t(`auth.onboarding.journey.${step.id}.title`)"
          class="mx-auto my-2 h-24 w-full object-contain"
        />
        <p class="text-xs leading-5 text-muted-foreground">
          {{ t(`auth.onboarding.journey.${step.id}.description`) }}
        </p>
      </li>
    </ol>
    <div class="rounded-lg border bg-muted/30 p-3 text-sm">
      <p class="font-medium">{{ t('auth.onboarding.safety.title') }}</p>
      <p class="mt-1 text-xs leading-5 text-muted-foreground">{{ t('auth.onboarding.safety.extension') }}</p>
    </div>
    <AlibabaIndependentNotice />
  </div>
</template>
