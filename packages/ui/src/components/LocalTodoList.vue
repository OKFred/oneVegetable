<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ListTodo, Plus, Trash2 } from '@lucide/vue';

import { useUiI18n } from '../i18n';
import {
  DASHBOARD_TODO_MAX_ITEMS,
  DASHBOARD_TODO_MAX_TEXT_LENGTH,
  type DashboardTodo
} from '../lib/local-todos';
import { createLocalTodoRepository, useDashboardTodos } from '../lib/todo-repository';
import TriStateCheckbox from './TriStateCheckbox.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import Button from './ui/Button.vue';
import ListActionButton from './ListActionButton.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';

const { t } = useUiI18n();
const injectedRepository = useDashboardTodos();
const repository = injectedRepository ?? createLocalTodoRepository();
const state = ref(repository.snapshot());
const items = computed(() => state.value.items);
const busy = ref(false);
const unsubscribe = repository.subscribe((snapshot) => {
  state.value = snapshot;
});
onMounted(() => {
  void run(() => repository.load());
});
onBeforeUnmount(() => {
  unsubscribe();
  if (!injectedRepository) repository.dispose();
});
const draft = ref('');
const clearConfirmationOpen = ref(false);
const remainingCount = computed(() => items.value.filter((item) => !item.completed).length);
const completedCount = computed(() => items.value.length - remainingCount.value);
const canAdd = computed(
  () =>
    !busy.value &&
    state.value.status !== 'loading' &&
    draft.value.trim().length > 0 &&
    draft.value.trim().length <= DASHBOARD_TODO_MAX_TEXT_LENGTH &&
    items.value.length < DASHBOARD_TODO_MAX_ITEMS
);

async function addTodo(): Promise<void> {
  if (!canAdd.value) return;
  await run(() => repository.add(draft.value));
  draft.value = '';
}

function setCompleted(todo: DashboardTodo, completed: boolean): void {
  void run(() => repository.setCompleted(todo.id, completed));
}

function removeTodo(todo: DashboardTodo): void {
  void run(() => repository.remove(todo.id));
}

async function clearCompleted(): Promise<void> {
  await run(() => repository.clearCompleted());
  clearConfirmationOpen.value = false;
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
    state.value = repository.snapshot();
  } catch {
    state.value = { ...repository.snapshot(), status: 'error' };
  } finally {
    busy.value = false;
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
          {{
            t(
              repository.mode === 'sync'
                ? 'shell.dashboard.todo.syncDescription'
                : 'shell.dashboard.todo.description'
            )
          }}
        </p>
      </div>
      <ListActionButton
        v-if="completedCount > 0"
        :icon="Trash2"
        data-testid="todo-clear-completed"
        :disabled="busy"
        @click="clearConfirmationOpen = true"
      >
        {{ t('shell.dashboard.todo.clearCompleted', { count: completedCount }) }}
      </ListActionButton>
    </div>

    <div class="p-5">
      <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="addTodo">
        <Input
          v-model="draft"
          :disabled="busy"
          :maxlength="DASHBOARD_TODO_MAX_TEXT_LENGTH"
          :placeholder="t('shell.dashboard.todo.placeholder')"
          :aria-label="t('shell.dashboard.todo.placeholder')"
          data-testid="todo-input"
        />
        <Button type="submit" :disabled="!canAdd" data-testid="todo-add">
          <Plus class="size-4" />{{ t('shell.dashboard.todo.add') }}
        </Button>
      </form>

      <p v-if="state.status === 'error'" class="mt-3 text-sm text-destructive" role="alert">
        {{ t('shell.dashboard.todo.storageError') }}
      </p>
      <p
        v-else-if="state.status === 'pending' || state.status === 'unavailable'"
        class="mt-3 text-sm text-amber-700 dark:text-amber-300"
        role="status"
      >
        {{
          t(
            state.status === 'pending'
              ? 'shell.dashboard.todo.syncPending'
              : 'shell.dashboard.todo.syncUnavailable'
          )
        }}
      </p>
      <p v-else-if="repository.mode === 'sync'" class="mt-3 text-xs text-muted-foreground" role="status">
        {{
          t(state.status === 'loading' ? 'shell.dashboard.todo.loading' : 'shell.dashboard.todo.syncStored')
        }}
      </p>
      <p v-if="state.problem" class="mt-2 text-sm text-destructive" role="alert">
        {{
          t(
            state.problem === 'quota'
              ? 'shell.dashboard.todo.syncQuota'
              : state.problem === 'conflict'
                ? 'shell.dashboard.todo.migrationConflict'
                : 'shell.dashboard.todo.invalidData'
          )
        }}
      </p>
      <Button
        v-if="['pending', 'unavailable', 'error'].includes(state.status)"
        class="mt-2"
        variant="outline"
        :disabled="busy"
        data-testid="todo-retry"
        @click="run(() => repository.retry())"
      >
        {{ t('common.todoSync.retry') }}
      </Button>
      <div
        v-if="repository.mode === 'sync' && state.migrationCount"
        class="mt-3 rounded-md border p-3 text-sm"
        data-testid="todo-migration"
      >
        <p>{{ t('shell.dashboard.todo.migrationDescription', { count: state.migrationCount }) }}</p>
        <Button
          class="mt-2"
          variant="outline"
          :disabled="busy"
          @click="run(() => repository.migrateLegacy())"
        >
          {{ t('shell.dashboard.todo.migrate') }}
        </Button>
      </div>
      <p
        v-if="items.length >= DASHBOARD_TODO_MAX_ITEMS"
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
            :disabled="busy"
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
            :disabled="busy"
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
  <ConfirmActionDialog
    v-model:open="clearConfirmationOpen"
    :title="t('shell.dashboard.todo.clearTitle')"
    :description="t('shell.dashboard.todo.clearDescription', { count: completedCount })"
    :confirm-label="t('shell.dashboard.todo.clearConfirm')"
    destructive
    @confirm="clearCompleted"
  />
</template>
