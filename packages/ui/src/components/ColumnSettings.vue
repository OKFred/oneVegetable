<script setup lang="ts">
import { computed, ref } from 'vue';
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui';
import { Columns3 } from '@lucide/vue';
import type { ColumnOption } from '../lib/column-preferences';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
const props = defineProps<{ options: ColumnOption[]; visible: string[] }>();
const emit = defineEmits<{ toggle: [id: string]; reset: [] }>();
const { t } = useUiI18n();
const search = ref('');
const filtered = computed(() =>
  props.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
  )
);
</script>
<template>
  <PopoverRoot>
    <PopoverTrigger as-child
      ><Button variant="outline"
        ><Columns3 class="size-4" />{{ t('common.columns.title') }}</Button
      ></PopoverTrigger
    >
    <PopoverPortal>
      <PopoverContent
        align="end"
        :side-offset="6"
        class="z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
      >
        <Input
          v-model="search"
          :placeholder="t('common.columns.search')"
          :aria-label="t('common.columns.search')"
        />
        <div class="my-2 max-h-72 overflow-auto">
          <label
            v-for="option in filtered"
            :key="option.id"
            class="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
            :class="{ 'opacity-60': option.locked }"
          >
            <input
              type="checkbox"
              :checked="visible.includes(option.id)"
              :disabled="option.locked"
              @change="emit('toggle', option.id)"
            />{{ option.label }}
          </label>
        </div>
        <Button variant="outline" @click="emit('reset')">{{ t('common.columns.reset') }}</Button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
