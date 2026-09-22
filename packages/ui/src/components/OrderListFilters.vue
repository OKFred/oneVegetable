<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useUiI18n } from '../i18n';
import ListFilterDialog from './ListFilterDialog.vue';
import Input from './ui/Input.vue';
import { platformDateFilter, validFilterRange } from '../lib/list-filters';
import type { TradeOrderListQuery } from '@one-vegetable/core';

type Filters = Omit<TradeOrderListQuery, 'page' | 'pageSize' | 'buyerLoginId'>;
const props = defineProps<{ modelValue: Filters }>();
const emit = defineEmits<{ 'update:modelValue': [value: Filters] }>();
const { t } = useUiI18n();
const open = ref(false);
const draft = ref<Filters>({});
watch(open, (value) => {
  if (value) draft.value = { ...props.modelValue };
});
const count = computed(
  () =>
    [
      props.modelValue.status,
      props.modelValue.salesmanId,
      Boolean(props.modelValue.createDateStart) || Boolean(props.modelValue.createDateEnd),
      Boolean(props.modelValue.modifiedDateStart) || Boolean(props.modelValue.modifiedDateEnd)
    ].filter(Boolean).length
);
const invalid = computed(
  () =>
    !validFilterRange(draft.value.createDateStart ?? '', draft.value.createDateEnd ?? '') ||
    !validFilterRange(draft.value.modifiedDateStart ?? '', draft.value.modifiedDateEnd ?? '')
);
const dates = ['createDateStart', 'createDateEnd', 'modifiedDateStart', 'modifiedDateEnd'] as const;
function apply(): void {
  if (invalid.value) return;
  emit('update:modelValue', {
    ...(draft.value.status ? { status: draft.value.status } : {}),
    ...(draft.value.salesmanId?.trim() ? { salesmanId: draft.value.salesmanId.trim() } : {}),
    ...Object.fromEntries(
      dates
        .filter((key) => draft.value[key])
        .map((key) => [key, platformDateFilter(draft.value[key] ?? '', key.endsWith('End'))])
    )
  });
  open.value = false;
}
</script>
<template>
  <ListFilterDialog
    v-model:open="open"
    :active-count="count"
    :invalid="invalid"
    @reset="draft = {}"
    @apply="apply"
  >
    <p class="text-xs font-semibold text-muted-foreground">{{ t('common.filters.server') }}</p>
    <label class="block space-y-1 text-sm"
      ><span>{{ t('orders.columns.status') }}</span>
      <select v-model="draft.status" class="h-9 w-full rounded-md border bg-background px-3 text-foreground">
        <option value="">{{ t('orders.filters.allStatuses') }}</option>
        <option
          v-for="status in ['unpay', 'paid', 'undeliver', 'delivering', 'trade_success', 'trade_close']"
          :key="status"
          :value="status"
        >
          {{
            t(
              `orders.filters.${status === 'trade_success' ? 'success' : status === 'trade_close' ? 'closed' : status}`
            )
          }}
        </option>
      </select>
    </label>
    <label class="block space-y-1 text-sm"
      ><span>{{ t('orders.filters.salesman') }}</span
      ><Input
        :model-value="draft.salesmanId ?? ''"
        @update:model-value="draft.salesmanId = $event"
        data-feedback-redact
        :aria-label="t('orders.filters.salesman')"
    /></label>
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="key in dates" :key="key" class="space-y-1 text-sm"
        ><span>{{ t(`orders.filters.${key}`) }}</span
        ><Input
          :model-value="draft[key] ?? ''"
          @update:model-value="draft[key] = $event"
          type="datetime-local"
          :aria-label="t(`orders.filters.${key}`)"
      /></label>
    </div>
    <p class="text-xs text-muted-foreground">{{ t('orders.filters.timeZoneWarning') }}</p>
    <p v-if="invalid" role="alert" class="text-sm text-destructive">{{ t('common.filters.invalidRange') }}</p>
  </ListFilterDialog>
</template>
