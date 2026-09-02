<script setup lang="ts">
import { computed, type Component } from 'vue';
import { ArrowUpRight, GitBranch, PackageCheck, ShieldCheck, Sparkles, Wrench } from '@lucide/vue';

import {
  RELEASE_NOTES,
  RELEASE_NOTES_REPOSITORY_URL,
  releaseNoteText,
  type LocalizedReleaseText,
  type ReleaseChangeType
} from '@one-vegetable/core';
import { APP_VERSION } from '@one-vegetable/core/version';

import PageHeader from '../components/PageHeader.vue';
import Badge from '../components/ui/Badge.vue';
import Card from '../components/ui/Card.vue';
import { formatDate } from '../lib/date-time';
import { useUiI18n } from '../i18n';

interface ChangePresentation {
  labelKey: string;
  icon: Component;
  className: string;
}

const changePresentation: Record<ReleaseChangeType, ChangePresentation> = {
  feature: {
    labelKey: 'releases.changeTypes.feature',
    icon: Sparkles,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800'
  },
  improvement: {
    labelKey: 'releases.changeTypes.improvement',
    icon: PackageCheck,
    className: 'border-blue-200 bg-blue-50 text-blue-950'
  },
  fix: {
    labelKey: 'releases.changeTypes.fix',
    icon: Wrench,
    className: 'border-amber-200 bg-amber-50 text-amber-900'
  },
  security: {
    labelKey: 'releases.changeTypes.security',
    icon: ShieldCheck,
    className: 'border-red-200 bg-red-50 text-red-900'
  }
};

const { locale, t } = useUiI18n();
const currentRelease = computed(() => RELEASE_NOTES.find((release) => release.version === APP_VERSION));

function localized(value: LocalizedReleaseText): string {
  return releaseNoteText(value, locale.value);
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <PageHeader
      :eyebrow="t('releases.eyebrow')"
      :title="t('releases.title')"
      :description="t('releases.description')"
    >
      <a
        :href="`${RELEASE_NOTES_REPOSITORY_URL}/releases`"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent"
      >
        <GitBranch class="size-4" />{{ t('releases.github') }}<ArrowUpRight class="size-3.5" />
      </a>
    </PageHeader>

    <Card class="relative mb-7 overflow-hidden border-emerald-200 bg-emerald-50 p-5 sm:p-6">
      <div
        class="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-primary/10 blur-2xl"
      />
      <div class="relative flex flex-wrap items-center justify-between gap-5">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {{ t('releases.installed') }}
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <p class="text-3xl font-semibold tracking-tight">v{{ APP_VERSION }}</p>
            <Badge variant="success">{{ t('releases.current') }}</Badge>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ currentRelease ? localized(currentRelease.title) : t('releases.missingCurrent') }}
          </p>
        </div>
        <PackageCheck class="size-11 text-primary" aria-hidden="true" />
      </div>
    </Card>

    <ol class="relative ml-3 border-l" :aria-label="t('releases.timeline')">
      <li v-for="release in RELEASE_NOTES" :key="release.version" class="relative mb-6 pl-7 last:mb-0">
        <span
          class="absolute -left-[0.44rem] top-6 size-3.5 rounded-full border-2 border-background bg-primary shadow-sm"
          aria-hidden="true"
        />
        <Card class="overflow-hidden">
          <header class="border-b bg-muted/30 p-5 sm:p-6">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-xl font-semibold">
                    v{{ release.version }} · {{ localized(release.title) }}
                  </h2>
                  <Badge v-if="release.version === APP_VERSION" variant="success">{{
                    t('releases.current')
                  }}</Badge>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ formatDate(release.releasedAt) }}
                </p>
              </div>
              <Badge variant="outline">
                {{ release.source === 'release' ? t('releases.sourceRelease') : t('releases.sourceTag') }}
              </Badge>
            </div>
            <p class="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {{ localized(release.summary) }}
            </p>
          </header>

          <div class="grid gap-3 p-5 sm:p-6 lg:grid-cols-2">
            <article
              v-for="change in release.changes"
              :key="`${release.version}-${change.type}-${change.title}`"
              class="rounded-lg border bg-background/70 p-4"
            >
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                  :class="changePresentation[change.type].className"
                >
                  <component :is="changePresentation[change.type].icon" class="size-3" />
                  {{ t(changePresentation[change.type].labelKey) }}
                </span>
                <h3 class="font-medium">{{ localized(change.title) }}</h3>
              </div>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">
                {{ localized(change.description) }}
              </p>
            </article>
          </div>

          <footer class="flex flex-wrap gap-4 border-t px-5 py-3 text-xs sm:px-6">
            <a
              :href="release.githubUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {{ release.source === 'release' ? t('releases.viewRelease') : t('releases.viewTag') }}
              <ArrowUpRight class="size-3" />
            </a>
            <a
              v-if="release.compareUrl"
              :href="release.compareUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
            >
              {{ t('releases.compare') }}<ArrowUpRight class="size-3" />
            </a>
          </footer>
        </Card>
      </li>
    </ol>
  </div>
</template>
