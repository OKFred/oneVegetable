<script setup lang="ts">
import { computed, type Component } from 'vue';
import { ArrowUpRight, GitBranch, PackageCheck, ShieldCheck, Sparkles, Wrench } from '@lucide/vue';

import { RELEASE_NOTES, RELEASE_NOTES_REPOSITORY_URL, type ReleaseChangeType } from '@one-vegetable/core';
import { APP_VERSION } from '@one-vegetable/core/version';

import PageHeader from '../components/PageHeader.vue';
import Badge from '../components/ui/Badge.vue';
import Card from '../components/ui/Card.vue';

interface ChangePresentation {
  label: string;
  icon: Component;
  className: string;
}

const changePresentation: Record<ReleaseChangeType, ChangePresentation> = {
  feature: {
    label: '新增',
    icon: Sparkles,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800'
  },
  improvement: {
    label: '改进',
    icon: PackageCheck,
    className: 'border-blue-200 bg-blue-50 text-blue-950'
  },
  fix: {
    label: '修复',
    icon: Wrench,
    className: 'border-amber-200 bg-amber-50 text-amber-900'
  },
  security: {
    label: '安全',
    icon: ShieldCheck,
    className: 'border-red-200 bg-red-50 text-red-900'
  }
};

const currentRelease = computed(() => RELEASE_NOTES.find((release) => release.version === APP_VERSION));

function formatReleaseDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${value}T00:00:00Z`));
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <PageHeader
      eyebrow="What's new"
      title="版本更新"
      description="查看每个正式版本面向用户的新增功能、体验改进和问题修复。版本说明随应用内置，离线或 GitHub 暂时不可用时也能正常查看。"
    >
      <a
        :href="`${RELEASE_NOTES_REPOSITORY_URL}/releases`"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent"
      >
        <GitBranch class="size-4" />GitHub 发布页<ArrowUpRight class="size-3.5" />
      </a>
    </PageHeader>

    <Card class="relative mb-7 overflow-hidden border-emerald-200 bg-emerald-50 p-5 sm:p-6">
      <div
        class="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-primary/10 blur-2xl"
      />
      <div class="relative flex flex-wrap items-center justify-between gap-5">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">当前安装版本</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <p class="text-3xl font-semibold tracking-tight">v{{ APP_VERSION }}</p>
            <Badge variant="success">当前版本</Badge>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ currentRelease?.title ?? '当前构建尚未发布正式版本说明' }}
          </p>
        </div>
        <PackageCheck class="size-11 text-primary" aria-hidden="true" />
      </div>
    </Card>

    <ol class="relative ml-3 border-l" aria-label="正式版本更新记录">
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
                  <h2 class="text-xl font-semibold">v{{ release.version }} · {{ release.title }}</h2>
                  <Badge v-if="release.version === APP_VERSION" variant="success">当前版本</Badge>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ formatReleaseDate(release.releasedAt) }}
                </p>
              </div>
              <Badge variant="outline">
                {{ release.source === 'release' ? 'GitHub Release' : 'Git Tag' }}
              </Badge>
            </div>
            <p class="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {{ release.summary }}
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
                  {{ changePresentation[change.type].label }}
                </span>
                <h3 class="font-medium">{{ change.title }}</h3>
              </div>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">{{ change.description }}</p>
            </article>
          </div>

          <footer class="flex flex-wrap gap-4 border-t px-5 py-3 text-xs sm:px-6">
            <a
              :href="release.githubUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              查看 {{ release.source === 'release' ? 'GitHub Release' : '代码标签' }}
              <ArrowUpRight class="size-3" />
            </a>
            <a
              v-if="release.compareUrl"
              :href="release.compareUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
            >
              完整代码差异<ArrowUpRight class="size-3" />
            </a>
          </footer>
        </Card>
      </li>
    </ol>
  </div>
</template>
