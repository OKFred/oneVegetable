<script setup lang="ts">
import { computed } from 'vue';
import { Building2, Clock3, ExternalLink, LocateFixed, RefreshCw, ShieldCheck } from '@lucide/vue';

import type { AlibabaCredentialPrerequisiteState } from '@one-vegetable/core';

import { useUiI18n } from '../i18n';
import { formatDateTime } from '../lib/date-time';
import Button from './ui/Button.vue';

const props = withDefaults(
  defineProps<{
    state: AlibabaCredentialPrerequisiteState;
    busy?: boolean;
    canLocate?: boolean;
    canRecheck?: boolean;
  }>(),
  { canRecheck: true }
);

const emit = defineEmits<{
  locate: [];
  recheck: [];
  'open-page': [];
}>();

const { t } = useUiI18n();

const registrationRequired = computed(
  () =>
    props.state.reasonCode === 'developer-registration-required' ||
    props.state.reasonCode === 'developer-registration-rejected'
);
const underReview = computed(() => props.state.reasonCode === 'developer-registration-under-review');
const applicationRequired = computed(
  () =>
    props.state.reasonCode === 'application-required' || props.state.reasonCode === 'application-not-ready'
);

const title = computed(() => {
  const titles = {
    'developer-registration-required': t('admin.alibabaPrerequisite.registration.title'),
    'developer-registration-under-review': t('admin.alibabaPrerequisite.review.title'),
    'developer-registration-rejected': t('admin.alibabaPrerequisite.registration.rejectedTitle'),
    'application-required': t('admin.alibabaPrerequisite.application.title'),
    'application-not-ready': t('admin.alibabaPrerequisite.application.notReadyTitle')
  };
  return titles[props.state.reasonCode];
});
</script>

<template>
  <section class="grid gap-4 rounded-xl border bg-card p-4" aria-live="polite">
    <div class="flex items-start gap-3">
      <Clock3 v-if="underReview" class="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
      <Building2 v-else class="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div class="min-w-0">
        <h3 class="font-semibold">{{ title }}</h3>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">
          <template v-if="registrationRequired">
            {{
              state.reasonCode === 'developer-registration-rejected'
                ? t('admin.alibabaPrerequisite.registration.rejectedDescription')
                : t('admin.alibabaPrerequisite.registration.description')
            }}
          </template>
          <template v-else-if="underReview">{{ t('admin.alibabaPrerequisite.review.description') }}</template>
          <template v-else>{{ t('admin.alibabaPrerequisite.application.description') }}</template>
        </p>
      </div>
    </div>

    <ul v-if="registrationRequired" class="grid gap-2 text-sm sm:grid-cols-2">
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.registration.region') }}
      </li>
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.registration.company') }}
      </li>
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.registration.number') }}
      </li>
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.registration.address') }}
      </li>
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.registration.document') }}
      </li>
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.registration.agreements') }}
      </li>
    </ul>

    <div
      v-if="registrationRequired"
      class="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100"
    >
      <ShieldCheck class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{{ t('admin.alibabaPrerequisite.registration.safety') }}</span>
    </div>

    <div v-if="underReview" class="rounded-lg bg-muted/45 p-3 text-sm leading-6">
      <p>{{ t('admin.alibabaPrerequisite.review.wait') }}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {{
          t('admin.alibabaPrerequisite.checkedAt', {
            time: formatDateTime(state.checkedAtUtc)
          })
        }}
      </p>
    </div>

    <ul v-if="applicationRequired" class="grid gap-2 text-sm sm:grid-cols-2">
      <li class="rounded-md bg-muted/45 px-3 py-2">{{ t('admin.alibabaPrerequisite.application.basic') }}</li>
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.application.callback') }}
      </li>
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.application.permissions') }}
      </li>
      <li class="rounded-md bg-muted/45 px-3 py-2">
        {{ t('admin.alibabaPrerequisite.application.status') }}
      </li>
    </ul>

    <p v-if="applicationRequired" class="text-xs leading-5 text-muted-foreground">
      {{ t('admin.alibabaPrerequisite.application.safety') }}
    </p>

    <div class="flex flex-wrap justify-end gap-2 border-t pt-3">
      <Button
        v-if="registrationRequired && canLocate"
        variant="outline"
        :disabled="busy"
        @click="emit('locate')"
      >
        <LocateFixed class="size-4" />{{ t('admin.alibabaPrerequisite.actions.locate') }}
      </Button>
      <Button variant="outline" :disabled="busy" @click="emit('open-page')">
        <ExternalLink class="size-4" />{{
          applicationRequired
            ? t('admin.alibabaPrerequisite.actions.openApplication')
            : t('admin.alibabaPrerequisite.actions.openRegistration')
        }}
      </Button>
      <Button v-if="canRecheck !== false" :disabled="busy" @click="emit('recheck')">
        <RefreshCw class="size-4" :class="busy ? 'animate-spin' : ''" />{{
          t('admin.alibabaPrerequisite.actions.recheck')
        }}
      </Button>
    </div>
  </section>
</template>
