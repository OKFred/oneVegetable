<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useUiI18n } from '../i18n';
import { validFilterRange } from '../lib/list-filters';
import ListFilterDialog from './ListFilterDialog.vue';
import Input from './ui/Input.vue';
import type { AuditFilters } from '../lib/audit-filters';
const props = defineProps<{ modelValue: AuditFilters; kind: 'audit' | 'requests' }>();
const emit = defineEmits<{ 'update:modelValue': [value: AuditFilters] }>();
const { t } = useUiI18n();
const open = ref(false);
const draft = ref<AuditFilters>({ actorId: '', operation: '', outcome: '', from: '', to: '' });
watch(open, (value) => {
  if (value) draft.value = { ...props.modelValue };
});
const count = computed(
  () =>
    [
      props.modelValue.actorId,
      props.modelValue.operation,
      props.modelValue.outcome,
      props.modelValue.from || props.modelValue.to
    ].filter(Boolean).length
);
const invalid = computed(() => !validFilterRange(draft.value.from, draft.value.to));
function apply(): void {
  if (invalid.value) return;
  emit('update:modelValue', { ...draft.value });
  open.value = false;
}
</script>
<template>
  <ListFilterDialog
    v-model:open="open"
    :active-count="count"
    :invalid="invalid"
    @apply="apply"
    @reset="draft = { actorId: '', operation: '', outcome: '', from: '', to: '' }"
  >
    <p class="text-xs text-muted-foreground">{{ t('common.filters.server') }}</p>
    <label class="block space-y-1 text-sm"
      ><span>{{ t('admin.listFilters.actor') }}</span
      ><Input v-model="draft.actorId" :aria-label="t('admin.listFilters.actor')"
    /></label>
    <label class="block space-y-1 text-sm"
      ><span>{{ t('admin.listFilters.operation') }}</span
      ><Input v-model="draft.operation" :aria-label="t('admin.listFilters.operation')"
    /></label>
    <label class="block space-y-1 text-sm"
      ><span>{{ t('admin.listFilters.outcome') }}</span>
      <select v-model="draft.outcome" class="h-9 w-full rounded-md border bg-background px-3 text-foreground">
        <option value="">{{ t('admin.listFilters.all') }}</option>
        <option v-for="outcome in ['success', 'error', 'denied']" :key="outcome" :value="outcome">
          {{ t(`admin.listFilters.${outcome}`) }}
        </option>
      </select>
    </label>
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="key in ['from', 'to'] as const" :key="key" class="space-y-1 text-sm"
        ><span>{{ t(`admin.listFilters.${key}`) }}</span
        ><Input v-model="draft[key]" type="datetime-local" :aria-label="t(`admin.listFilters.${key}`)"
      /></label>
    </div>
    <p v-if="invalid" role="alert" class="text-sm text-destructive">{{ t('common.filters.invalidRange') }}</p>
  </ListFilterDialog>
</template>
