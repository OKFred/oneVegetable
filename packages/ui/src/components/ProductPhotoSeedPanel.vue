<script setup lang="ts">
import { X } from '@lucide/vue';
import type { Photo } from '@one-vegetable/core';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';

defineProps<{ photos: Photo[]; applied: boolean; error: string; busy: boolean; canApply: boolean }>();
const emit = defineEmits<{ remove: [id: string]; retry: []; cancel: [] }>();
const { t } = useUiI18n();
</script>

<template>
  <section class="mt-4 rounded-lg border bg-muted/30 p-4" data-testid="product-photo-seed" :aria-busy="busy">
    <h3 class="text-sm font-medium">{{ t('photos.productSeed.title', { count: photos.length }) }}</h3>
    <p class="mt-1 text-sm text-muted-foreground" role="status">
      {{ applied ? t('photos.productSeed.applied', { count: photos.length }) : t('photos.productSeed.hint') }}
    </p>
    <template v-if="!applied">
      <ol class="mt-3 flex flex-wrap gap-3">
        <li v-for="(photo, index) in photos" :key="photo.id" class="relative">
          <img :src="photo.url" :alt="photo.name" class="size-20 rounded-md border object-contain" />
          <span v-if="index === 0" class="absolute bottom-0 left-0 rounded bg-background px-1 text-xs">{{
            t('photos.productSeed.main')
          }}</span>
          <Button
            size="icon"
            variant="outline"
            class="absolute -right-2 -top-2 size-6"
            :disabled="busy"
            :aria-label="t('photos.productSeed.remove') + ': ' + photo.name"
            @click="emit('remove', photo.id)"
            ><X class="size-3"
          /></Button>
        </li>
      </ol>
      <p v-if="error" role="alert" class="mt-3 text-sm text-destructive">{{ error }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button v-if="canApply" variant="outline" :disabled="busy" @click="emit('retry')">{{
          t('photos.productSeed.retry')
        }}</Button>
        <Button variant="ghost" :disabled="busy" @click="emit('cancel')">{{
          t('photos.productSeed.cancel')
        }}</Button>
      </div>
    </template>
  </section>
</template>
