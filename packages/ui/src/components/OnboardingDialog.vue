<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowRight, Check, ShieldCheck } from '@lucide/vue';

import applicationSetupImage from '../assets/onboarding/application-setup.webp';
import developerRegistrationImage from '../assets/onboarding/developer-registration.webp';
import oauthSecureImage from '../assets/onboarding/oauth-secure.webp';
import reviewWaitImage from '../assets/onboarding/review-wait.webp';
import { useUiI18n } from '../i18n';
import AlibabaIndependentNotice from './AlibabaIndependentNotice.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import { useServices } from '../lib/services';

const emit = defineEmits<{ ready: [destination?: 'credential-acquisition'] }>();
const { t } = useUiI18n();
const { onboarding, mode } = useServices();
const visible = ref(false);
const acknowledged = ref(false);
const saving = ref(false);
const error = ref('');
const available = computed(() => mode !== 'mock' && onboarding !== undefined);
const steps = computed(() => [
  {
    image: developerRegistrationImage,
    title: t('auth.onboarding.journey.registration.title'),
    description: t('auth.onboarding.journey.registration.description')
  },
  {
    image: reviewWaitImage,
    title: t('auth.onboarding.journey.review.title'),
    description: t('auth.onboarding.journey.review.description')
  },
  {
    image: applicationSetupImage,
    title: t('auth.onboarding.journey.application.title'),
    description: t('auth.onboarding.journey.application.description')
  },
  {
    image: oauthSecureImage,
    title: t('auth.onboarding.journey.authorization.title'),
    description: t('auth.onboarding.journey.authorization.description')
  }
]);

onMounted(async () => {
  if (!available.value || !onboarding) {
    emit('ready');
    return;
  }
  try {
    visible.value = (await onboarding.load()).completedAt === null;
    if (!visible.value) emit('ready');
  } catch (reason: unknown) {
    visible.value = true;
    error.value = reason instanceof Error ? reason.message : t('auth.onboarding.readError');
  }
});

async function finish(destination?: 'credential-acquisition'): Promise<void> {
  if (!onboarding || !acknowledged.value) return;
  saving.value = true;
  error.value = '';
  try {
    await onboarding.complete();
    visible.value = false;
    emit('ready', destination);
  } catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : t('auth.onboarding.saveError');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Transition name="ov-modal">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <Card class="ov-modal-panel my-6 w-full max-w-5xl p-5 shadow-2xl sm:p-6">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          {{ t('auth.onboarding.eyebrow') }}
        </p>
        <h1 id="onboarding-title" class="mt-2 text-2xl font-semibold sm:text-3xl">
          {{ t('auth.onboarding.title') }}
        </h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {{
            t(
              mode === 'extension'
                ? 'auth.onboarding.introduction.extension'
                : 'auth.onboarding.introduction.selfHosted'
            )
          }}
        </p>
        <ol
          class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          :aria-label="t('auth.onboarding.journey.label')"
        >
          <li
            v-for="(step, index) in steps"
            :key="step.title"
            class="group relative overflow-hidden rounded-xl border bg-gradient-to-b from-emerald-50/80 to-background p-4 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:from-emerald-950/20"
          >
            <span
              class="absolute left-3 top-3 grid size-7 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white dark:bg-emerald-500 dark:text-slate-950"
              aria-hidden="true"
            >
              {{ index + 1 }}
            </span>
            <img
              :src="step.image"
              :alt="step.title"
              class="mx-auto h-28 w-full object-contain transition-transform duration-200 group-hover:scale-[1.03] sm:h-32"
            />
            <h2 class="mt-2 font-semibold">{{ step.title }}</h2>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">{{ step.description }}</p>
          </li>
        </ol>
        <div
          class="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm leading-6 dark:border-emerald-900 dark:bg-emerald-950/25"
        >
          <ShieldCheck class="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <div>
            <p class="font-medium">{{ t('auth.onboarding.safety.title') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{
                t(
                  mode === 'extension'
                    ? 'auth.onboarding.safety.extension'
                    : 'auth.onboarding.safety.selfHosted'
                )
              }}
            </p>
          </div>
        </div>
        <AlibabaIndependentNotice class="mt-4" />
        <label class="mt-5 flex items-start gap-3 rounded-lg bg-muted p-4 text-sm leading-6">
          <input
            v-model="acknowledged"
            name="acknowledgedDataBoundaries"
            type="checkbox"
            class="mt-1 size-4 accent-emerald-600"
            required
          />
          <span>{{ t('auth.onboarding.acknowledgement') }}</span>
        </label>
        <p v-if="error" class="mt-3 text-sm text-destructive">{{ error }}</p>
        <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
          <a class="text-sm text-emerald-700 underline" href="/privacy.html" target="_blank">{{
            t('auth.onboarding.privacy')
          }}</a>
          <div class="flex flex-wrap justify-end gap-2">
            <Button variant="outline" :disabled="!acknowledged || saving" @click="finish()">
              {{ t('auth.onboarding.browseOnly') }}
            </Button>
            <Button :disabled="!acknowledged || saving" @click="finish('credential-acquisition')">
              <Check class="size-4" />{{ t('auth.onboarding.configure') }}<ArrowRight class="size-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  </Transition>
</template>
