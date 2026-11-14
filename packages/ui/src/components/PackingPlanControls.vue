<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Download, FolderOpen, Save, Trash2, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import { useUiI18n } from '../i18n';
import { formatDateTime } from '../lib/date-time';
import type { PackingInput } from '../lib/packing-layout';
import {
  createPackingPlan,
  deletePackingPlan,
  PackingPlanError,
  PACKING_PLAN_MAX_BYTES,
  parsePackingPlanJson,
  readSavedPackingPlans,
  savePackingPlan,
  serializePackingPlan,
  type PackingPlan,
  type SavedPackingPlan
} from '../lib/packing-plans';

const props = defineProps<{ active: boolean; hasInput: boolean; readInput: () => PackingInput }>();
const emit = defineEmits<{ apply: [input: PackingInput] }>();
const { t } = useUiI18n();
const dialog = ref<'save' | 'open' | null>(null);
const name = ref('');
const dialogError = ref('');
const plans = shallowRef<SavedPackingPlan[]>([]);
const preparedInput = shallowRef<PackingInput | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const pending = shallowRef<
  | { action: 'apply'; plan: PackingPlan }
  | { action: 'overwrite'; plan: PackingPlan }
  | { action: 'delete'; name: string }
  | null
>(null);
let revision = 0;
function message(cause: unknown): string {
  return cause instanceof PackingPlanError
    ? t('logistics.packing.plans.' + cause.code)
    : cause instanceof Error
      ? cause.message
      : t('logistics.packing.invalidInput');
}
watch(
  () => props.active,
  (active) => {
    if (!active) {
      revision++;
      dialog.value = null;
      pending.value = null;
    }
  }
);
onBeforeUnmount(() => {
  revision++;
});
function openSave(): void {
  try {
    preparedInput.value = props.readInput();
    dialogError.value = '';
    dialog.value = 'save';
  } catch (cause) {
    toast.error(message(cause));
  }
}
function openPlans(): void {
  dialogError.value = '';
  dialog.value = 'open';
  try {
    plans.value = readSavedPackingPlans();
  } catch (cause) {
    plans.value = [];
    dialogError.value = message(cause);
  }
}
function persist(plan: PackingPlan): void {
  savePackingPlan(plan);
  name.value = plan.name;
  dialog.value = null;
  toast.success(t('logistics.packing.plans.saved'));
}
function save(): void {
  if (!preparedInput.value) return;
  try {
    const plan = createPackingPlan(name.value, preparedInput.value);
    if (readSavedPackingPlans().some((item) => item.plan.name.toLowerCase() === plan.name.toLowerCase())) {
      dialog.value = null;
      pending.value = { action: 'overwrite', plan };
    } else persist(plan);
  } catch (cause) {
    dialogError.value = message(cause);
  }
}
function apply(plan: PackingPlan): void {
  dialog.value = null;
  if (props.hasInput) pending.value = { action: 'apply', plan };
  else applyNow(plan);
}
function applyNow(plan: PackingPlan): void {
  name.value = plan.name;
  emit('apply', plan.input);
  toast.success(t('logistics.packing.plans.loaded'));
}
function requestDelete(plan: PackingPlan): void {
  dialog.value = null;
  pending.value = { action: 'delete', name: plan.name };
}
function confirm(): void {
  const action = pending.value;
  pending.value = null;
  if (!action || !props.active) return;
  try {
    if (action.action === 'apply') applyNow(action.plan);
    else if (action.action === 'overwrite') persist(action.plan);
    else {
      deletePackingPlan(action.name);
      openPlans();
    }
  } catch (cause) {
    toast.error(message(cause));
  }
}
async function importFile(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;
  const current = ++revision;
  try {
    if (file.size > PACKING_PLAN_MAX_BYTES) throw new PackingPlanError('invalidFile');
    const plan = parsePackingPlanJson(await file.text());
    if (current !== revision || !props.active) return;
    apply(plan);
  } catch (cause) {
    if (current === revision && props.active) toast.error(message(cause));
  }
}
function exportFile(): void {
  try {
    const plan = createPackingPlan(name.value || t('logistics.packing.plans.defaultName'), props.readInput());
    const url = URL.createObjectURL(new Blob([serializePackingPlan(plan)], { type: 'application/json' }));
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = 'one-vegetable-packing-' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    globalThis.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
    toast.info(t('logistics.packing.plans.downloadStarted'));
  } catch (cause) {
    toast.error(message(cause));
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-2" data-testid="packing-plan-controls">
    <Button
      variant="outline"
      :disabled="!hasInput || !active"
      data-testid="packing-plan-save"
      @click="openSave"
    >
      <Save class="size-4 shrink-0" aria-hidden="true" />{{ t('logistics.packing.plans.save') }}
    </Button>
    <Button variant="outline" :disabled="!active" data-testid="packing-plan-open" @click="openPlans">
      <FolderOpen class="size-4 shrink-0" aria-hidden="true" />{{ t('logistics.packing.plans.open') }}
    </Button>
    <Button variant="outline" :disabled="!active" @click="fileInput?.click()">
      <Upload class="size-4 shrink-0" aria-hidden="true" />{{ t('logistics.packing.plans.import') }}
    </Button>
    <input
      ref="fileInput"
      class="hidden"
      type="file"
      accept=".json,application/json"
      data-testid="packing-plan-file"
      :aria-label="t('logistics.packing.plans.import')"
      @change="importFile"
    />
    <Button
      variant="outline"
      :disabled="!hasInput || !active"
      data-testid="packing-plan-export"
      @click="exportFile"
    >
      <Download class="size-4 shrink-0" aria-hidden="true" />{{ t('logistics.packing.plans.export') }}
    </Button>
  </div>
  <ModalDialog
    :open="dialog !== null"
    :title="t(dialog === 'save' ? 'logistics.packing.plans.save' : 'logistics.packing.plans.open')"
    :description="t('logistics.packing.plans.localNotice')"
    @update:open="dialog = null"
  >
    <p v-if="dialogError" role="alert" class="mb-3 text-sm text-destructive">{{ dialogError }}</p>
    <form v-if="dialog === 'save'" class="space-y-4" @submit.prevent="save">
      <label class="block space-y-2 text-sm">
        <span>{{ t('logistics.packing.plans.name') }}</span>
        <Input v-model="name" maxlength="80" required data-testid="packing-plan-name" />
      </label>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="dialog = null">{{ t('common.actions.cancel') }}</Button>
        <Button type="submit" data-testid="packing-plan-save-confirm">{{ t('common.actions.save') }}</Button>
      </div>
    </form>
    <div v-else class="space-y-3">
      <p v-if="!plans.length && !dialogError" class="text-sm text-muted-foreground">
        {{ t('logistics.packing.plans.empty') }}
      </p>
      <div
        v-for="item in plans"
        :key="item.plan.name"
        class="flex flex-wrap items-center gap-3 rounded-lg border p-3"
      >
        <div class="min-w-0 flex-1">
          <p class="break-words text-sm font-medium">{{ item.plan.name }}</p>
          <p class="mt-1 whitespace-nowrap text-xs text-muted-foreground">
            {{ formatDateTime(item.savedAtUtc) }}
          </p>
        </div>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" @click="apply(item.plan)">{{
            t('logistics.packing.plans.load')
          }}</Button>
          <Button
            size="sm"
            variant="outline"
            :aria-label="t('logistics.packing.plans.deleteNamed', { name: item.plan.name })"
            @click="requestDelete(item.plan)"
          >
            <Trash2 class="size-4 shrink-0" aria-hidden="true" />{{ t('common.actions.delete') }}
          </Button>
        </div>
      </div>
    </div>
  </ModalDialog>
  <ConfirmActionDialog
    :open="pending !== null"
    :destructive="pending?.action === 'delete'"
    :title="
      t(
        pending?.action === 'delete'
          ? 'logistics.packing.plans.deleteTitle'
          : pending?.action === 'overwrite'
            ? 'logistics.packing.plans.overwriteTitle'
            : 'logistics.packing.replaceTitle'
      )
    "
    :description="
      t(
        pending?.action === 'apply'
          ? 'logistics.packing.replaceDescription'
          : 'logistics.packing.plans.confirmDescription'
      )
    "
    @update:open="pending = null"
    @confirm="confirm"
  />
</template>
