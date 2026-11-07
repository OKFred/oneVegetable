<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Box, LoaderCircle, Plus, RotateCcw, Square, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import { useUiI18n } from '../i18n';
import { defineAsyncContent } from '../lib/async-content';
import { PACKING_COLORS } from '../lib/packing-colors';
import {
  validatePackingInput,
  validatePackingResult,
  type PackingInput,
  type PackingResult
} from '../lib/packing-layout';

const PackingScene = defineAsyncContent(() => import('./PackingScene.vue'));
const props = defineProps<{ active: boolean }>();
const { t } = useUiI18n();
interface DimensionsDraft {
  length: string;
  width: string;
  height: string;
}
interface CargoDraft extends DimensionsDraft {
  id: string;
  name: string;
  quantity: string;
  allowRotation: boolean;
}
const axes = ['length', 'width', 'height'] as const;
const emptyDimensions = (): DimensionsDraft => ({ length: '', width: '', height: '' });
let nextId = 0;
const newCargo = (): CargoDraft => ({
  ...emptyDimensions(),
  id: String(++nextId),
  name: '',
  quantity: '1',
  allowRotation: false
});
const container = ref(emptyDimensions());
const cargo = ref<CargoDraft[]>([newCargo()]);
const preview = shallowRef<{ input: PackingInput; result: PackingResult } | null>(null);
const busy = ref(false);
const error = ref('');
const selectedCargoId = ref<string | null>(null);
const view = ref<'perspective' | 'top' | 'front' | 'side'>('perspective');
const resetKey = ref(0);
const visible = ref(true);
const replaceAction = ref<'example' | 'clear' | null>(null);
let worker: Worker | undefined;
const hasInput = computed(
  () =>
    axes.some((axis) => container.value[axis] !== '') ||
    cargo.value.some(
      (item) =>
        item.name || axes.some((axis) => item[axis] !== '') || item.quantity !== '1' || item.allowRotation
    ) ||
    cargo.value.length > 1
);
const utilization = computed(() =>
  preview.value
    ? ((preview.value.result.usedVolume / preview.value.result.containerVolume) * 100).toFixed(1)
    : '0.0'
);
const volume = (value: number): string =>
  (value / 1_000_000_000).toFixed(9).replace(/0+$/u, '').replace(/\.$/u, '');
const color = (index: number): string => PACKING_COLORS[index % PACKING_COLORS.length] ?? PACKING_COLORS[0];

function stop(): void {
  worker?.terminate();
  worker = undefined;
  busy.value = false;
}
function invalidate(): void {
  stop();
  preview.value = null;
  selectedCargoId.value = null;
  error.value = '';
}
watch([container, cargo], invalidate, { deep: true, flush: 'sync' });
watch(
  () => props.active,
  (active) => {
    if (!active) stop();
  }
);
function updateVisibility(): void {
  visible.value = !globalThis.document.hidden;
  if (!visible.value) stop();
}
onMounted(() => {
  updateVisibility();
  globalThis.document.addEventListener('visibilitychange', updateVisibility);
});
onBeforeUnmount(() => {
  stop();
  globalThis.document.removeEventListener('visibilitychange', updateVisibility);
});

function dimensions(draft: DimensionsDraft): PackingInput['container'] {
  const result = { length: 0, width: 0, height: 0 };
  for (const axis of axes) {
    const text = draft[axis].trim();
    const value = Number(text);
    if (!/^\d+(?:\.\d)?$/u.test(text) || value < 0.1 || value > 10_000) {
      throw new Error(t('logistics.packing.invalidDimensions'));
    }
    result[axis] = Math.round(value * 10);
  }
  return result;
}
function generate(): void {
  if (busy.value || !props.active || !visible.value) return;
  error.value = '';
  preview.value = null;
  let input: PackingInput;
  try {
    input = {
      container: dimensions(container.value),
      cargo: cargo.value.map((item, index) => {
        if (!item.name.trim() || item.name.trim().length > 100) {
          throw new Error(t('logistics.packing.invalidName', { row: index + 1 }));
        }
        if (!/^[1-9]\d*$/u.test(item.quantity) || Number(item.quantity) > 500) {
          throw new Error(t('logistics.packing.invalidQuantity'));
        }
        return {
          id: item.id,
          name: item.name.trim(),
          size: dimensions(item),
          quantity: Number(item.quantity),
          allowRotation: item.allowRotation
        };
      })
    };
    if (input.cargo.reduce((sum, item) => sum + item.quantity, 0) > 500) {
      throw new Error(t('logistics.packing.invalidQuantity'));
    }
    validatePackingInput(input);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('logistics.packing.invalidInput');
    return;
  }
  try {
    const current = new Worker(new URL('../workers/packing.worker.ts', import.meta.url), { type: 'module' });
    worker = current;
    busy.value = true;
    current.onmessage = (event: MessageEvent<{ result?: PackingResult; error?: string }>) => {
      if (worker !== current) return;
      try {
        if (!event.data.result || event.data.error) throw new Error('Invalid packing response');
        validatePackingResult(input, event.data.result);
        preview.value = { input, result: event.data.result };
        selectedCargoId.value = null;
        view.value = 'perspective';
        resetKey.value++;
      } catch {
        error.value = t('logistics.packing.calculationFailed');
      } finally {
        stop();
      }
    };
    current.onerror = (event) => {
      event.preventDefault();
      if (worker !== current) return;
      error.value = t('logistics.packing.calculationFailed');
      stop();
    };
    current.postMessage(input);
  } catch {
    stop();
    error.value = t('logistics.packing.calculationFailed');
  }
}
function replaceInputs(action: 'example' | 'clear'): void {
  if (hasInput.value) replaceAction.value = action;
  else applyReplacement(action);
}
function applyReplacement(action: 'example' | 'clear'): void {
  replaceAction.value = null;
  container.value = action === 'example' ? { length: '60', width: '50', height: '45' } : emptyDimensions();
  cargo.value =
    action === 'example'
      ? [
          {
            ...newCargo(),
            name: t('logistics.packing.exampleA'),
            length: '20',
            width: '15',
            height: '20',
            quantity: '12'
          },
          {
            ...newCargo(),
            name: t('logistics.packing.exampleB'),
            length: '10',
            width: '15',
            height: '10',
            quantity: '8'
          }
        ]
      : [newCargo()];
}
function stopWithFeedback(): void {
  stop();
  toast.info(t('logistics.packing.stopped'));
}
function selectCargo(id: string | null): void {
  selectedCargoId.value = selectedCargoId.value === id ? null : id;
}
</script>

<template>
  <section data-testid="packing-workspace" class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted-foreground">{{ t('logistics.packing.localOnly') }}</p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" data-testid="packing-example" @click="replaceInputs('example')">
          <Box class="size-4" aria-hidden="true" />{{ t('logistics.packing.loadExample') }}
        </Button>
        <Button variant="outline" :disabled="!hasInput" @click="replaceInputs('clear')">
          <Trash2 class="size-4" aria-hidden="true" />{{ t('logistics.packing.clear') }}
        </Button>
      </div>
    </div>
    <div class="grid items-start gap-4 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(180px,220px)]">
      <form class="min-w-0 space-y-4" novalidate @submit.prevent="generate">
        <Card class="space-y-4 p-4">
          <h2 class="font-semibold">{{ t('logistics.packing.container') }}</h2>
          <div class="grid grid-cols-3 gap-2">
            <label v-for="axis in axes" :key="axis" class="min-w-0 space-y-1 text-sm">
              <span>{{ t('logistics.packing.' + axis) }} (cm)</span>
              <Input
                :model-value="container[axis]"
                @update:model-value="container[axis] = String($event)"
                :data-testid="'packing-container-' + axis"
                type="number"
                min="0.1"
                max="10000"
                step="0.1"
                inputmode="decimal"
              />
            </label>
          </div>
        </Card>
        <Card class="space-y-4 p-4">
          <h2 class="font-semibold">{{ t('logistics.packing.cargo') }}</h2>
          <p class="text-xs text-muted-foreground">{{ t('logistics.packing.limits') }}</p>
          <fieldset
            v-for="(item, index) in cargo"
            :key="item.id"
            class="min-w-0 space-y-3 border-b pb-4"
            :data-testid="'packing-cargo-' + index"
          >
            <legend class="mb-2 flex w-full items-center justify-between gap-2 text-sm font-medium">
              <span class="flex items-center gap-2"
                ><span class="size-3 rounded-sm" :style="{ backgroundColor: color(index) }" />{{
                  t('logistics.packing.cargoNumber', { count: index + 1 })
                }}</span
              >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                :disabled="cargo.length === 1"
                :aria-label="t('logistics.packing.removeCargo', { count: index + 1 })"
                @click="cargo.splice(index, 1)"
                ><Trash2 class="size-4" aria-hidden="true"
              /></Button>
            </legend>
            <label class="block space-y-1 text-sm"
              ><span>{{ t('logistics.packing.name') }}</span
              ><Input v-model="item.name" maxlength="100"
            /></label>
            <div class="grid grid-cols-3 gap-2">
              <label v-for="axis in axes" :key="axis" class="min-w-0 space-y-1 text-sm"
                ><span>{{ t('logistics.packing.' + axis) }} (cm)</span
                ><Input
                  :model-value="item[axis]"
                  @update:model-value="item[axis] = String($event)"
                  type="number"
                  min="0.1"
                  max="10000"
                  step="0.1"
                  inputmode="decimal"
              /></label>
            </div>
            <label class="block space-y-1 text-sm"
              ><span>{{ t('logistics.packing.quantity') }}</span
              ><Input
                :model-value="item.quantity"
                type="number"
                min="1"
                max="500"
                step="1"
                inputmode="numeric"
                @update:model-value="item.quantity = String($event)"
            /></label>
            <label class="flex items-center gap-2 text-sm"
              ><input v-model="item.allowRotation" type="checkbox" class="size-4 shrink-0 accent-primary" />{{
                t('logistics.packing.rotation')
              }}</label
            >
          </fieldset>
          <Button
            type="button"
            variant="outline"
            class="w-full"
            :disabled="cargo.length >= 20"
            @click="cargo.push(newCargo())"
            ><Plus class="size-4" aria-hidden="true" />{{ t('logistics.packing.addCargo') }}</Button
          >
          <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
          <Button v-if="!busy" type="submit" class="w-full" data-testid="packing-generate"
            ><Box class="size-4" aria-hidden="true" />{{ t('logistics.packing.generate') }}</Button
          >
          <Button
            v-else
            type="button"
            variant="outline"
            class="w-full"
            data-testid="packing-stop"
            @click="stopWithFeedback"
            ><LoaderCircle class="size-4 animate-spin" aria-hidden="true" /><Square
              class="size-3"
              aria-hidden="true"
            />{{ t('logistics.packing.stop') }}</Button
          >
        </Card>
      </form>
      <Card class="min-w-0 space-y-4 p-4">
        <h2 class="font-semibold">{{ t('logistics.packing.arrangement') }}</h2>
        <div class="flex flex-wrap gap-2" role="group" :aria-label="t('logistics.packing.views')">
          <Button
            v-for="option in ['perspective', 'top', 'front', 'side'] as const"
            :key="option"
            size="sm"
            :variant="view === option ? 'secondary' : 'outline'"
            :aria-pressed="view === option"
            :disabled="!preview"
            @click="view = option"
            >{{ t('logistics.packing.' + option) }}</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="!preview"
            @click="
              view = 'perspective';
              resetKey++;
            "
            ><RotateCcw class="size-4" aria-hidden="true" />{{ t('logistics.packing.resetView') }}</Button
          >
        </div>
        <PackingScene
          v-if="active && visible && preview"
          :input="preview.input"
          :result="preview.result"
          :selected-cargo-id="selectedCargoId"
          :view="view"
          :reset-key="resetKey"
          @select="selectCargo"
        />
        <div
          v-else
          class="flex min-h-80 items-center justify-center rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground"
          aria-live="polite"
        >
          {{ busy ? t('logistics.packing.calculating') : t('logistics.packing.empty') }}
        </div>
        <p v-if="preview" class="text-xs text-muted-foreground">{{ t('logistics.packing.sceneHelp') }}</p>
        <div
          v-if="preview"
          class="flex flex-wrap gap-2"
          role="group"
          :aria-label="t('logistics.packing.cargo')"
        >
          <Button
            v-for="(item, index) in preview.input.cargo"
            :key="item.id"
            size="sm"
            :variant="selectedCargoId === item.id ? 'secondary' : 'outline'"
            :aria-pressed="selectedCargoId === item.id"
            @click="selectCargo(item.id)"
            ><span class="size-3 shrink-0 rounded-sm" :style="{ backgroundColor: color(index) }" /><span
              class="max-w-36 truncate"
              >{{ item.name }}</span
            ><span
              >{{ preview.result.placements.filter((placement) => placement.cargoId === item.id).length }} /
              {{ item.quantity }}</span
            ></Button
          >
        </div>
        <p class="text-xs leading-6 text-muted-foreground">{{ t('logistics.packing.disclaimer') }}</p>
      </Card>
      <Card class="min-w-0 space-y-4 p-4" aria-live="polite" data-testid="packing-results">
        <h2 class="font-semibold">{{ t('logistics.packing.results') }}</h2>
        <template v-if="preview">
          <dl class="grid grid-cols-2 gap-4 xl:grid-cols-1">
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('logistics.packing.total') }}</dt>
              <dd class="mt-1 text-2xl font-semibold">{{ preview.result.totalCount }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('logistics.packing.packed') }}</dt>
              <dd class="mt-1 text-2xl font-semibold" data-testid="packing-packed">
                {{ preview.result.packedCount }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('logistics.packing.unpacked') }}</dt>
              <dd class="mt-1 text-2xl font-semibold">
                {{ preview.result.totalCount - preview.result.packedCount }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('logistics.packing.utilization') }}</dt>
              <dd class="mt-1 text-2xl font-semibold">{{ utilization }}%</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('logistics.packing.containerVolume') }}</dt>
              <dd class="mt-1 text-sm font-medium">{{ volume(preview.result.containerVolume) }} m³</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('logistics.packing.usedVolume') }}</dt>
              <dd class="mt-1 text-sm font-medium">{{ volume(preview.result.usedVolume) }} m³</dd>
            </div>
          </dl>
          <ul v-if="preview.result.unplaced.length" class="space-y-3 border-t pt-4 text-sm">
            <li v-for="item in preview.result.unplaced" :key="item.cargoId">
              <span class="font-medium"
                >{{ preview.input.cargo.find((entry) => entry.id === item.cargoId)?.name }} ·
                {{ item.count }}</span
              >
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('logistics.packing.reason.' + item.reason) }}
              </p>
            </li>
          </ul>
        </template>
        <p v-else class="text-sm text-muted-foreground">{{ t('logistics.packing.empty') }}</p>
      </Card>
    </div>
    <ConfirmActionDialog
      :open="replaceAction !== null"
      :title="t('logistics.packing.replaceTitle')"
      :description="t('logistics.packing.replaceDescription')"
      @update:open="replaceAction = null"
      @confirm="replaceAction && applyReplacement(replaceAction)"
    />
  </section>
</template>
