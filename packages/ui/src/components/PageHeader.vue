<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description: string }>();
</script>

<template>
  <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
    <div>
      <p v-if="eyebrow" class="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
        {{ eyebrow }}
      </p>
      <h1 class="text-2xl font-semibold tracking-tight">{{ title }}</h1>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">{{ description }}</p>
    </div>
    <slot />
  </header>
</template>
