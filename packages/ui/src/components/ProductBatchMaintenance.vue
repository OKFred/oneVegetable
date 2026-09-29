<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, toRaw } from 'vue';
import { toast } from 'vue-sonner';
import {
  ProductBatchMaintenanceRunner,
  type ProductMaintenanceItem
} from '@one-vegetable/core/product-batch-runner';
import type { ProductBatchMaintenanceRules } from '@one-vegetable/core/product-batch-maintenance';
import type { AlibabaLanguage, Product, ProductGroup } from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { useUiI18n } from '../i18n';
import { useProductMaintenanceI18n } from '../i18n/productMaintenance';
import { useUnsavedEditing } from '../lib/unsaved-editing';
import {
  useOperationAvailability,
  operationAvailabilityMessage
} from '../composables/use-operation-availability';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import Card from './ui/Card.vue';
import ErrorNotice from './ErrorNotice.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ProductGroupNavigation from './ProductGroupNavigation.vue';

const props = defineProps<{ products: Product[]; language: AlibabaLanguage }>();
const emit = defineEmits<{ close: []; tasks: [] }>();
const { gateway, productMutationJobs } = useServices();
const availability = useOperationAvailability(['updateProduct']);
const { locale } = useUiI18n();
const t = useProductMaintenanceI18n();
const groupEnabled = ref(false);
const groupPath = ref<ProductGroup[]>([]);
const groupId = ref<number | null>(null);
const keywordAction = ref<'keep' | 'append' | 'remove' | 'replace'>('keep');
const keywordInputs = ref(['']);
const items = shallowRef<ProductMaintenanceItem[]>([]);
const busy = ref(false);
const started = ref(false);
const confirm = ref(false);
const error = shallowRef<unknown>(null);
const selection = ref<string[]>([]);
let alive = true;
let runner: ProductBatchMaintenanceRunner | null = null;
const locksAvailable =
  'locks' in globalThis.navigator && typeof globalThis.navigator.locks.request === 'function';
const rules = computed<ProductBatchMaintenanceRules>(() => ({
  groupPath: groupEnabled.value ? groupPath.value.map(({ id, name }) => ({ id, name })) : null,
  keywords:
    keywordAction.value === 'keep' ? null : { action: keywordAction.value, values: [...keywordInputs.value] }
}));
const editing = useUnsavedEditing(() => rules.value, { enabled: () => !started.value });
const ready = computed(() =>
  items.value.filter((item) => item.state === 'ready' && selection.value.includes(item.product.id))
);
const verified = computed(() => items.value.filter((item) => item.state === 'verified').length);
function changed(): void {
  if (alive && runner) items.value = runner.items.map((item) => ({ ...item }));
}
async function preview(): Promise<void> {
  if (busy.value || started.value) return;
  error.value = null;
  if (!rules.value.groupPath && !rules.value.keywords) {
    toast.error(t('rulesRequired'));
    return;
  }
  if (groupEnabled.value && !groupPath.value.length) {
    toast.error(t('groupRequired'));
    return;
  }
  if (rules.value.keywords && !rules.value.keywords.values.some((v) => v.trim())) {
    toast.error(t('keywordsRequired'));
    return;
  }
  if (!productMutationJobs) {
    error.value = new Error('PRODUCT_CONTEXT_UNAVAILABLE');
    return;
  }
  busy.value = true;
  try {
    runner?.stop();
    runner = new ProductBatchMaintenanceRunner({
      gateway,
      jobs: productMutationJobs,
      products: props.products.map((p) => toRaw(p)),
      language: props.language,
      locale: locale.value,
      changed
    });
    await runner.preview(rules.value);
    if (alive) {
      changed();
      selection.value = runner.items.filter((item) => item.state === 'ready').map((item) => item.product.id);
    }
  } catch (cause) {
    if (alive) error.value = cause;
  } finally {
    if (alive) busy.value = false;
  }
}
function invalidate(): void {
  if (!busy.value && !started.value) {
    runner?.stop();
    runner = null;
    items.value = [];
    selection.value = [];
  }
}
function selectPath(path: ProductGroup[]): void {
  groupPath.value = path;
  invalidate();
}
async function execute(): Promise<void> {
  confirm.value = false;
  if (
    !runner ||
    busy.value ||
    started.value ||
    !ready.value.length ||
    !locksAvailable ||
    !availability.isAllowed('updateProduct')
  )
    return;
  busy.value = true;
  const active = runner;
  try {
    await globalThis.navigator.locks.request(
      'one-vegetable-product-batch-maintenance',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          toast.warning(t('locked'));
          return;
        }
        active.items.forEach((item) => {
          item.selected = selection.value.includes(item.product.id);
        });
        started.value = true;
        editing.markClean();
        await active.execute();
      }
    );
  } catch (cause) {
    if (alive) error.value = cause;
  } finally {
    if (alive) {
      busy.value = false;
      changed();
    }
  }
}
function stop(): void {
  runner?.stop();
  toast.info(t('stopped'));
}
async function close(tasks = false): Promise<void> {
  if (!(await editing.confirmLeave())) return;
  runner?.stop();
  if (tasks) emit('tasks');
  else emit('close');
}
function pageExit(): void {
  runner?.stop();
}
globalThis.addEventListener('pagehide', pageExit);
onBeforeUnmount(() => {
  alive = false;
  runner?.stop();
  globalThis.removeEventListener('pagehide', pageExit);
});
defineExpose({ confirmLeave: editing.confirmLeave, stop: () => runner?.stop() });
</script>
<template>
  <section class="space-y-4" data-testid="product-batch-maintenance">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ t('title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('scope', { count: products.length }) }}</p>
      </div>
      <Button variant="outline" @click="close()">{{ t('back') }}</Button>
    </div>
    <p v-if="!products.length">{{ t('empty') }}</p>
    <Card v-else-if="!started" class="space-y-4 p-4">
      <fieldset :disabled="busy" class="grid gap-4 lg:grid-cols-2">
        <div class="space-y-2">
          <label class="flex gap-2"
            ><input v-model="groupEnabled" type="checkbox" @change="invalidate" />{{ t('group') }}</label
          >
          <div v-if="groupEnabled" class="max-h-72 overflow-auto rounded border">
            <ProductGroupNavigation v-model="groupId" @select-path="selectPath" />
          </div>
          <p v-else class="text-sm text-muted-foreground">{{ t('keep') }}</p>
          <p v-if="groupPath.length" class="text-sm">{{ groupPath.map((g) => g.name).join(' / ') }}</p>
        </div>
        <div class="space-y-2">
          <label class="block"
            >{{ t('keywords')
            }}<select
              v-model="keywordAction"
              class="ml-2 rounded border bg-background p-2"
              @change="invalidate"
            >
              <option
                v-for="action in ['keep', 'append', 'remove', 'replace'] as const"
                :key="action"
                :value="action"
              >
                {{ t(action) }}
              </option>
            </select></label
          >
          <template v-if="keywordAction !== 'keep'"
            ><div v-for="(_, index) in keywordInputs" :key="index" class="flex gap-2">
              <Input
                :model-value="keywordInputs[index] ?? ''"
                :aria-label="`${t('keywords')} ${index + 1}`"
                :placeholder="t('keywordPlaceholder')"
                @update:model-value="
                  keywordInputs[index] = $event;
                  invalidate();
                "
              /><Button
                variant="outline"
                :aria-label="t('removeKeyword')"
                @click="
                  keywordInputs.splice(index, 1);
                  invalidate();
                "
                >−</Button
              >
            </div>
            <Button
              variant="outline"
              @click="
                keywordInputs.push('');
                invalidate();
              "
              >{{ t('addKeyword') }}</Button
            ></template
          >
        </div>
      </fieldset>
      <Button :disabled="busy || !products.length" @click="preview">{{ t('preview') }}</Button>
    </Card>
    <ErrorNotice v-if="error" :error="error" />
    <p v-if="!locksAvailable" class="text-sm text-destructive">{{ t('locksUnavailable') }}</p>
    <div v-if="items.length" class="max-h-[60vh] space-y-3 overflow-auto">
      <Card v-for="item in items" :key="item.product.id" class="space-y-2 p-4">
        <div class="flex items-center gap-2">
          <input
            v-model="selection"
            type="checkbox"
            :value="item.product.id"
            :disabled="busy || started || item.state !== 'ready'"
            :aria-label="item.product.subject"
          />
          <h3 class="min-w-0 flex-1 truncate font-medium">{{ item.product.subject }}</h3>
          <span class="text-xs">{{ t(item.state) }}</span>
        </div>
        <code class="text-xs text-muted-foreground">{{ item.product.id }}</code>
        <dl v-if="item.preview" class="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt class="font-medium">{{ t('before') }}</dt>
            <dd v-if="rules.groupPath">
              {{ t('group') }}: {{ item.product.groupName || item.preview.before.groups.join(' / ') || '—' }}
            </dd>
            <dd v-if="rules.keywords">
              {{ t('keywords') }}: {{ item.preview.before.keywords.join(' · ') || '—' }}
            </dd>
          </div>
          <div>
            <dt class="font-medium">{{ t('after') }}</dt>
            <dd v-if="rules.groupPath">
              {{ t('group') }}: {{ rules.groupPath.map((g) => g.name).join(' / ') }}
            </dd>
            <dd v-if="rules.keywords">
              {{ t('keywords') }}: {{ item.preview.after.keywords.join(' · ') || '—' }}
            </dd>
          </div>
        </dl>
        <p v-if="item.preview?.reason" class="text-sm text-destructive">
          {{ t(item.preview.reason as 'structure') }}
        </p>
        <ul v-if="item.preview?.warnings.length" class="list-inside list-disc text-xs text-muted-foreground">
          <li v-for="warning in item.preview.warnings" :key="warning">{{ warning }}</li>
        </ul>
        <ErrorNotice v-if="item.error" :error="item.error" compact />
        <code v-if="item.requestId" class="block break-all text-xs">requestId: {{ item.requestId }}</code>
      </Card>
    </div>
    <div
      v-if="items.length"
      class="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
      aria-live="polite"
    >
      <div>
        <p>{{ t('progress', { verified, total: items.length }) }}</p>
        <p class="text-xs text-muted-foreground">{{ t('warning') }}</p>
      </div>
      <div class="flex gap-2">
        <Button v-if="busy" variant="outline" @click="stop">{{ t('stop') }}</Button
        ><Button
          v-else-if="!started"
          :disabled="!ready.length || !locksAvailable || !availability.isAllowed('updateProduct')"
          :title="operationAvailabilityMessage(availability.reasonCode('updateProduct'), '')"
          @click="confirm = true"
          >{{ t('execute') }}</Button
        ><Button v-if="started" variant="outline" @click="close(true)">{{ t('taskCenter') }}</Button>
      </div>
    </div>
    <ConfirmActionDialog
      v-model:open="confirm"
      :title="t('execute')"
      :description="t('review', { count: ready.length, skipped: products.length - ready.length })"
      @confirm="execute"
    />
  </section>
</template>
