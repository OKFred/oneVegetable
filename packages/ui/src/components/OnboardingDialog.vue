<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check, Database, FlaskConical, KeyRound, ShieldCheck } from '@lucide/vue';

import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import { useServices } from '../lib/services';

const emit = defineEmits<{ ready: [destination?: 'settings'] }>();
const { t } = useUiI18n();
const { onboarding, mode } = useServices();
const visible = ref(false);
const acknowledged = ref(false);
const saving = ref(false);
const error = ref('');
const available = computed(() => mode === 'extension' && onboarding !== undefined);

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

async function finish(destination?: 'settings'): Promise<void> {
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
      <Card class="ov-modal-panel my-6 w-full max-w-2xl p-6 shadow-2xl">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          {{ t('auth.onboarding.eyebrow') }}
        </p>
        <h1 id="onboarding-title" class="mt-2 text-2xl font-semibold">
          {{ t('auth.onboarding.title') }}
        </h1>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          {{ t('auth.onboarding.introduction') }}
        </p>
        <ol class="mt-4 grid gap-2 rounded-lg border bg-muted/40 p-4 text-sm leading-6">
          <li><strong>1.</strong> {{ t('auth.onboarding.steps.application') }}</li>
          <li><strong>2.</strong> {{ t('auth.onboarding.steps.oauth') }}</li>
          <li><strong>3.</strong> {{ t('auth.onboarding.steps.settings') }}</li>
        </ol>
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-lg border p-4">
            <KeyRound class="size-5 text-emerald-700" />
            <p class="mt-2 font-medium">{{ t('auth.onboarding.vault.title') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{ t('auth.onboarding.vault.description') }}
            </p>
          </div>
          <div class="rounded-lg border p-4">
            <ShieldCheck class="size-5 text-emerald-700" />
            <p class="mt-2 font-medium">{{ t('auth.onboarding.permissions.title') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{ t('auth.onboarding.permissions.description') }}
            </p>
          </div>
          <div class="rounded-lg border p-4">
            <FlaskConical class="size-5 text-emerald-700" />
            <p class="mt-2 font-medium">{{ t('auth.onboarding.verification.title') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{ t('auth.onboarding.verification.description') }}
            </p>
          </div>
          <div class="rounded-lg border p-4">
            <Database class="size-5 text-emerald-700" />
            <p class="mt-2 font-medium">{{ t('auth.onboarding.localData.title') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{ t('auth.onboarding.localData.description') }}
            </p>
          </div>
        </div>
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
            <Button :disabled="!acknowledged || saving" @click="finish('settings')">
              <Check class="size-4" />{{ t('auth.onboarding.configure') }}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  </Transition>
</template>
