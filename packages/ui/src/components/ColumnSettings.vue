<script setup lang="ts">
import { computed, ref } from 'vue';
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui';
import { ArrowDown, ArrowUp, Columns3, GripVertical } from '@lucide/vue';
import type { ColumnOption } from '../lib/column-preferences';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import TriStateCheckbox from './TriStateCheckbox.vue';
const props = defineProps<{ options: ColumnOption[]; visible: string[]; persistenceFailed?: boolean }>();
const emit = defineEmits<{
  toggle: [id: string];
  reset: [];
  'set-all': [checked: boolean];
  move: [id: string, target: string];
  'move-by': [id: string, delta: number];
}>();
const { t } = useUiI18n();
const search = ref('');
const dragging = ref<string | null>(null);
const optional = computed(() => props.options.filter((option) => !option.locked));
const selectedCount = computed(
  () => optional.value.filter((option) => props.visible.includes(option.id)).length
);
function drop(target: string): void {
  if (dragging.value) emit('move', dragging.value, target);
  dragging.value = null;
}
const filtered = computed(() =>
  props.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
  )
);
</script>
<template>
  <PopoverRoot>
    <PopoverTrigger as-child
      ><Button
        variant="ghost"
        size="icon"
        class="size-7"
        :aria-label="t('common.columns.title')"
        :title="t('common.columns.title')"
        ><Columns3 class="size-3.5" /></Button
    ></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        align="end"
        :side-offset="6"
        :collision-padding="8"
        class="z-[90] flex max-h-[min(calc(100dvh-1rem),var(--reka-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
      >
        <Input
          v-model="search"
          class="shrink-0"
          :placeholder="t('common.columns.search')"
          :aria-label="t('common.columns.search')"
        />
        <label class="my-3 flex shrink-0 cursor-pointer items-center gap-2 text-sm">
          <TriStateCheckbox
            :checked="optional.length > 0 && selectedCount === optional.length"
            :indeterminate="selectedCount > 0 && selectedCount < optional.length"
            :disabled="optional.length === 0"
            :label="t('common.columns.all')"
            @update:checked="emit('set-all', $event)"
          />{{ t('common.columns.all') }}
        </label>
        <div class="my-2 min-h-0 max-h-72 overflow-y-auto overscroll-contain">
          <div
            v-for="option in filtered"
            :key="option.id"
            class="flex items-center gap-2 rounded py-1.5 text-sm hover:bg-muted"
            :class="{ 'opacity-60': option.locked }"
            :draggable="!option.locked"
            @dragstart="dragging = option.id"
            @dragend="dragging = null"
            @dragover.prevent
            @drop.prevent="drop(option.id)"
          >
            <GripVertical class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <TriStateCheckbox
              :checked="visible.includes(option.id)"
              :disabled="option.locked"
              :label="option.label"
              @update:checked="emit('toggle', option.id)"
            />
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left"
              :disabled="option.locked"
              @click="emit('toggle', option.id)"
            >
              {{ option.label }}
            </button>
            <template v-if="!option.locked">
              <Button
                variant="ghost"
                size="icon"
                class="size-7 shrink-0"
                :disabled="optional[0]?.id === option.id"
                :aria-label="t('common.columns.moveUp', { name: option.label })"
                @click="emit('move-by', option.id, -1)"
                ><ArrowUp class="size-3.5"
              /></Button>
              <Button
                variant="ghost"
                size="icon"
                class="size-7 shrink-0"
                :disabled="optional.at(-1)?.id === option.id"
                :aria-label="t('common.columns.moveDown', { name: option.label })"
                @click="emit('move-by', option.id, 1)"
                ><ArrowDown class="size-3.5"
              /></Button>
            </template>
          </div>
        </div>
        <p v-if="persistenceFailed" role="status" class="mb-2 shrink-0 text-xs text-destructive">
          {{ t('common.columns.persistenceFailed') }}
        </p>
        <Button variant="outline" class="shrink-0 self-start" @click="emit('reset')">{{
          t('common.columns.reset')
        }}</Button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
