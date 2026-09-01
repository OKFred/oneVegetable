<script setup lang="ts">
import { computed, ref } from 'vue';
import { ListTodo, Plus, Trash2 } from '@lucide/vue';

import { useUiI18n } from '../i18n';
import {
  addDashboardTodo,
  clearCompletedDashboardTodos,
  DASHBOARD_TODO_MAX_ITEMS,
  DASHBOARD_TODO_MAX_TEXT_LENGTH,
  loadDashboardTodos,
  removeDashboardTodo,
  saveDashboardTodos,
  updateDashboardTodoCompletion,
  type DashboardTodo
} from '../lib/local-todos';
import TriStateCheckbox from './TriStateCheckbox.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';

const { t } = useUiI18n();
const storage = browserStorage();
const items = ref<DashboardTodo[]>(storage ? loadDashboardTodos(storage) : []);
const draft = ref('');
const persistenceFailed = ref(!storage);
const remainingCount = computed(() => items.value.filter((item) => !item.completed).length);
const completedCount = computed(() => items.value.length - remainingCount.value);
const canAdd = computed(() => draft.value.trim().length > 0 && items.value.length < DASHBOARD_TODO_MAX_ITEMS);

function addTodo(): void {
  if (!canAdd.value) return;
  const next = addDashboardTodo(items.value, draft.value);
  if (next.length === items.value.length) return;
  persist(next);
  draft.value = '';
}

function setCompleted(todo: DashboardTodo, completed: boolean): void {
  persist(updateDashboardTodoCompletion(items.value, todo.id, completed));
}

function removeTodo(todo: DashboardTodo): void {
  persist(removeDashboardTodo(items.value, todo.id));
}

function clearCompleted(): void {
  persist(clearCompletedDashboardTodos(items.value));
}

function persist(next: DashboardTodo[]): void {
  items.value = next;
  if (!storage) {
    persistenceFailed.value = true;
    return;
  }
  try {
    saveDashboardTodos(storage, next);
    persistenceFailed.value = false;
  } catch {
    persistenceFailed.value = true;
  }
}

function browserStorage(): Storage | undefined {
  try {
    return 'localStorage' in globalThis ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}
</script>

<template>
  <Card class="overflow-hidden" data-testid="local-todo-list">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b p-5">
      <div>
        <div class="flex items-center gap-2">
          <ListTodo class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('shell.dashboard.todo.title') }}</h2>
        </div>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('shell.dashboard.todo.description') }}
        </p>
      </div>
      <Button
        v-if="completedCount > 0"
        variant="ghost"
        size="sm"
        data-testid="todo-clear-completed"
        @click="clearCompleted"
      >
        {{ t('shell.dashboard.todo.clearCompleted', { count: completedCount }) }}
      </Button>
    </div>

    <div class="p-5">
      <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="addTodo">
        <Input
          v-model="draft"
          :maxlength="DASHBOARD_TODO_MAX_TEXT_LENGTH"
          :placeholder="t('shell.dashboard.todo.placeholder')"
          :aria-label="t('shell.dashboard.todo.placeholder')"
          data-testid="todo-input"
        />
        <Button type="submit" :disabled="!canAdd" data-testid="todo-add">
          <Plus class="size-4" />{{ t('shell.dashboard.todo.add') }}
        </Button>
      </form>

      <p v-if="persistenceFailed" class="mt-3 text-sm text-destructive" role="alert">
        {{ t('shell.dashboard.todo.storageError') }}
      </p>
      <p
        v-else-if="items.length >= DASHBOARD_TODO_MAX_ITEMS"
        class="mt-3 text-sm text-amber-700 dark:text-amber-300"
      >
        {{ t('shell.dashboard.todo.limitReached', { count: DASHBOARD_TODO_MAX_ITEMS }) }}
      </p>

      <div v-if="items.length === 0" class="py-10 text-center text-sm text-muted-foreground">
        {{ t('shell.dashboard.todo.empty') }}
      </div>
      <ul v-else class="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
        <li
          v-for="todo in items"
          :key="todo.id"
          class="group flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 transition-colors hover:bg-muted/50"
        >
          <TriStateCheckbox
            :checked="todo.completed"
            :label="
              t(todo.completed ? 'shell.dashboard.todo.markActive' : 'shell.dashboard.todo.markCompleted', {
                text: todo.text
              })
            "
            @update:checked="setCompleted(todo, $event)"
          />
          <span
            class="min-w-0 flex-1 break-words text-sm"
            :class="todo.completed ? 'text-muted-foreground line-through' : 'text-foreground'"
          >
            {{ todo.text }}
          </span>
          <Button
            variant="ghost"
            size="icon"
            class="size-8 text-muted-foreground opacity-70 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
            :aria-label="t('shell.dashboard.todo.delete', { text: todo.text })"
            :title="t('shell.dashboard.todo.delete', { text: todo.text })"
            @click="removeTodo(todo)"
          >
            <Trash2 class="size-4" />
          </Button>
        </li>
      </ul>

      <p class="mt-3 text-xs text-muted-foreground" aria-live="polite">
        {{ t('shell.dashboard.todo.remaining', { count: remainingCount }) }}
      </p>
    </div>
  </Card>
</template>
