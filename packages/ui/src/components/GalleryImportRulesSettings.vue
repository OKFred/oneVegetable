<script setup lang="ts">
import { ref } from 'vue';
import { Plus, Save, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';

import type { GalleryImportRule, GalleryImportRuleSet } from '@one-vegetable/core';

import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import { useUiI18n } from '../i18n';
import { loadGalleryImportRuleSet, saveGalleryImportRuleSet } from '../lib/gallery-import-rules-storage';

const { t } = useUiI18n();
const ruleSet = ref<GalleryImportRuleSet>(loadGalleryImportRuleSet());
const error = ref('');

function addRule(): void {
  ruleSet.value.rules.push({
    id: globalThis.crypto.randomUUID(),
    name: t('settings.s3.rules.newRule'),
    enabled: true,
    sourcePrefix: '',
    includeGlob: '**',
    excludeGlobs: [],
    targetGroupPath: 'Imported'
  });
}

function removeRule(id: string): void {
  ruleSet.value.rules = ruleSet.value.rules.filter((rule) => rule.id !== id);
}

function updateExcludes(rule: GalleryImportRule, value: string): void {
  rule.excludeGlobs = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function save(): void {
  error.value = '';
  try {
    ruleSet.value = saveGalleryImportRuleSet(ruleSet.value);
    toast.success(t('settings.s3.rules.saved'));
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : t('settings.s3.rules.invalid');
  }
}
</script>

<template>
  <div class="mt-5 border-t pt-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold">{{ t('settings.s3.rules.title') }}</h3>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">{{ t('settings.s3.rules.description') }}</p>
      </div>
      <Button size="sm" variant="outline" @click="addRule">
        <Plus class="size-3.5" />{{ t('settings.s3.rules.add') }}
      </Button>
    </div>
    <label class="mt-4 block max-w-xs text-sm font-medium">
      {{ t('settings.s3.rules.conflict') }}
      <select
        v-model="ruleSet.conflictPolicy"
        class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
      >
        <option value="rename">{{ t('settings.s3.rules.rename') }}</option>
        <option value="skip">{{ t('settings.s3.rules.skip') }}</option>
      </select>
    </label>
    <div class="mt-4 grid gap-3">
      <div v-for="rule in ruleSet.rules" :key="rule.id" class="rounded-lg border p-4">
        <div class="flex items-center justify-between gap-3">
          <label class="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input v-model="rule.enabled" class="size-4 accent-primary" type="checkbox" />
            {{ t('settings.s3.rules.enabled') }}
          </label>
          <Button
            size="icon"
            variant="ghost"
            :aria-label="t('settings.s3.rules.remove')"
            @click="removeRule(rule.id)"
          >
            <Trash2 class="size-4" />
          </Button>
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="text-xs font-medium">
            {{ t('settings.s3.rules.name') }}
            <Input v-model="rule.name" class="mt-1" />
          </label>
          <label class="text-xs font-medium">
            {{ t('settings.s3.rules.sourcePrefix') }}
            <Input v-model="rule.sourcePrefix" class="mt-1" placeholder="catalog/shirts" />
          </label>
          <label class="text-xs font-medium">
            {{ t('settings.s3.rules.include') }}
            <Input v-model="rule.includeGlob" class="mt-1" placeholder="**/*.jpg" />
          </label>
          <label class="text-xs font-medium">
            {{ t('settings.s3.rules.exclude') }}
            <Input
              :model-value="rule.excludeGlobs.join(', ')"
              class="mt-1"
              placeholder="**/thumb-*, **/.DS_Store"
              @update:model-value="updateExcludes(rule, String($event))"
            />
          </label>
          <label class="text-xs font-medium sm:col-span-2">
            {{ t('settings.s3.rules.targetGroup') }}
            <Input v-model="rule.targetGroupPath" class="mt-1" placeholder="Imported/Shirts" />
          </label>
        </div>
      </div>
      <p v-if="ruleSet.rules.length === 0" class="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        {{ t('settings.s3.rules.empty') }}
      </p>
    </div>
    <p v-if="error" class="mt-3 text-sm text-destructive">{{ error }}</p>
    <Button class="mt-3" size="sm" variant="outline" @click="save">
      <Save class="size-3.5" />{{ t('settings.s3.rules.save') }}
    </Button>
  </div>
</template>
