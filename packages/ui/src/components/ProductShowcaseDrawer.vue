<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowUp, ArrowDown, Replace } from '@lucide/vue';
import { toast } from 'vue-sonner';
import type { useProductShowcase, ShowcaseTarget, ShowcaseEditIntent } from '../lib/product-showcase';
import { useShowcaseI18n } from '../i18n/showcase';
import { useUiI18n } from '../i18n';
import Sheet from './ui/Sheet.vue';
import Button from './ui/Button.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import ActionTooltip from './ActionTooltip.vue';
import ModalDialog from './ui/ModalDialog.vue';
import ProductReplacementPicker from './ProductReplacementPicker.vue';

const props = defineProps<{
  open: boolean;
  controller: ReturnType<typeof useProductShowcase>;
  selection: readonly ShowcaseTarget[];
  action: 'add' | 'remove' | null;
}>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const s = useShowcaseI18n();
const { t } = useUiI18n();
const pending = ref<{ action: 'add' | 'remove'; products: ShowcaseTarget[] } | null>(null);
const acknowledge = ref(false);
const editIntent = ref<ShowcaseEditIntent | null>(null);
const replacementWindowId = ref('');
const excludedIds = computed(
  () => props.controller.snapshot.value?.entries.map((entry) => entry.productId) ?? []
);
function move(windowId: string, targetOrder: number): void {
  editIntent.value = props.controller.prepareEdit('sort', windowId, targetOrder);
}
function replace(product: ShowcaseTarget): void {
  editIntent.value = props.controller.prepareEdit('replace', replacementWindowId.value, product);
  if (editIntent.value) replacementWindowId.value = '';
}
async function confirmEdit(): Promise<void> {
  if (!editIntent.value) return;
  await props.controller.edit(editIntent.value);
  editIntent.value = null;
}
function request(action: 'add' | 'remove', products: readonly ShowcaseTarget[]): void {
  const refusal = props.controller.reason(action, products);
  if (refusal) {
    toast.warning(refusal);
    return;
  }
  pending.value = { action, products: products.map(({ id, subject, status }) => ({ id, subject, status })) };
}
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      pending.value = null;
      editIntent.value = null;
      replacementWindowId.value = '';
      return;
    }
    await props.controller.load(true);
    if (props.open && props.action) request(props.action, props.selection);
  },
  { immediate: true }
);
async function confirm(): Promise<void> {
  if (!pending.value) return;
  await props.controller.mutate(pending.value.action, pending.value.products);
  pending.value = null;
}
function close(open: boolean): void {
  if (!props.controller.busy.value) emit('update:open', open);
}
async function unlock(): Promise<void> {
  try {
    await props.controller.acknowledgeReceipt();
    acknowledge.value = false;
  } catch {
    toast.error(s('locked'));
  }
}
</script>
<template>
  <Sheet :open="open" :title="s('title')" :description="s('note')" @update:open="close">
    <template #toolbar>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span v-if="controller.snapshot.value" aria-live="polite">{{
          s('quota', controller.snapshot.value)
        }}</span>
        <Button
          variant="outline"
          :disabled="controller.loading.value || controller.busy.value"
          @click="controller.load(true)"
          >{{ s('refresh') }}</Button
        >
      </div>
    </template>
    <div class="space-y-4">
      <ErrorNotice v-if="controller.error.value" :error="controller.error.value" />
      <p v-if="controller.loading.value" role="status">{{ t('common.columns.loading') }}</p>
      <div
        v-if="controller.unresolved.value"
        class="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        role="status"
      >
        <p>{{ s('recovered') }}</p>
        <code>{{ controller.requestId.value }}</code>
        <p v-if="controller.pendingAction.value">
          {{ s(controller.pendingAction.value) }} · {{ controller.pendingIds.value.join(', ') }}
        </p>
        <Button
          variant="outline"
          :disabled="controller.busy.value || !controller.snapshot.value"
          @click="acknowledge = true"
          >{{ s('unlock') }}</Button
        >
      </div>
      <p v-if="controller.snapshot.value?.entries.length === 0">{{ s('empty') }}</p>
      <ul class="space-y-2">
        <li
          v-for="(entry, index) in controller.snapshot.value?.entries ?? []"
          :key="entry.windowId"
          class="flex flex-wrap items-center gap-3 rounded-md border p-3"
        >
          <img
            v-if="entry.imageUrl"
            :src="entry.imageUrl"
            alt=""
            class="size-16 shrink-0 rounded object-cover"
            referrerpolicy="no-referrer"
          />
          <div class="min-w-0 flex-1">
            <p class="text-xs text-muted-foreground">{{ s('position', { order: index + 1 }) }}</p>
            <p class="line-clamp-2 break-words">{{ entry.subject ?? '—' }}</p>
            <code class="text-xs text-muted-foreground">{{ entry.productId }}</code>
          </div>
          <div class="flex gap-1">
            <ActionTooltip
              v-for="direction in [-1, 1] as const"
              :key="direction"
              :reason="
                controller.editReason('sort', entry.windowId, index + 1 + direction) ||
                s(direction === -1 ? 'up' : 'down')
              "
              :disabled="Boolean(controller.editReason('sort', entry.windowId, index + 1 + direction))"
            >
              <Button
                variant="outline"
                size="icon"
                :aria-label="s(direction === -1 ? 'up' : 'down')"
                :disabled="Boolean(controller.editReason('sort', entry.windowId, index + 1 + direction))"
                @click="move(entry.windowId, index + 1 + direction)"
              >
                <ArrowUp v-if="direction === -1" class="size-4" /><ArrowDown v-else class="size-4" />
              </Button>
            </ActionTooltip>
            <ActionTooltip
              :reason="controller.editReason('replace', entry.windowId)"
              :disabled="Boolean(controller.editReason('replace', entry.windowId))"
            >
              <Button
                variant="outline"
                size="sm"
                :disabled="Boolean(controller.editReason('replace', entry.windowId))"
                @click="replacementWindowId = entry.windowId"
                ><Replace class="size-4" />{{ s('replace') }}</Button
              >
            </ActionTooltip>
          </div>
          <ActionTooltip
            :reason="
              controller.reason('remove', [
                { id: entry.productId, subject: entry.subject ?? '', status: 'online' }
              ])
            "
            :disabled="
              Boolean(
                controller.reason('remove', [
                  { id: entry.productId, subject: entry.subject ?? '', status: 'online' }
                ])
              )
            "
          >
            <Button
              variant="outline"
              size="sm"
              :disabled="
                Boolean(
                  controller.reason('remove', [
                    { id: entry.productId, subject: entry.subject ?? '', status: 'online' }
                  ])
                )
              "
              @click="
                request('remove', [{ id: entry.productId, subject: entry.subject ?? '', status: 'online' }])
              "
              >{{ s('remove') }}</Button
            >
          </ActionTooltip>
        </li>
      </ul>
    </div>
  </Sheet>
  <ModalDialog
    :open="Boolean(replacementWindowId)"
    :title="s('chooseReplacement')"
    :description="s('replacementOnline')"
    size="lg"
    @update:open="replacementWindowId = ''"
  >
    <ProductReplacementPicker v-if="replacementWindowId" :excluded-ids="excludedIds" @select="replace" />
  </ModalDialog>
  <ConfirmActionDialog
    :open="editIntent !== null"
    :pending="controller.busy.value"
    :description="s('editNote')"
    :title="
      editIntent?.action === 'sort'
        ? s('move', { from: editIntent.request.sourceOrder, to: editIntent.request.targetOrder })
        : s('replace')
    "
    @update:open="editIntent = null"
    @confirm="confirmEdit"
  >
    <p>{{ s('editNote') }}</p>
    <p v-if="editIntent">
      {{ s('before') }}:
      {{
        editIntent.request.expectedEntries.find((entry) => entry.windowId === editIntent?.request.windowId)
          ?.productId
      }}
    </p>
    <p v-if="editIntent?.action === 'replace'">{{ s('after') }}: {{ editIntent.request.newProductId }}</p>
  </ConfirmActionDialog>
  <ConfirmActionDialog
    :open="pending !== null"
    :title="
      pending ? s('confirm', { action: s(pending.action), count: pending.products.length }) : s('title')
    "
    :pending="controller.busy.value"
    :description="s('note')"
    :destructive="pending?.action === 'remove'"
    @update:open="pending = null"
    @confirm="confirm"
  >
    <p>{{ s('note') }}</p>
    <ul class="max-h-64 overflow-auto">
      <li v-for="product in pending?.products ?? []" :key="product.id">
        {{ product.subject }} · {{ product.id }}
      </li>
    </ul>
  </ConfirmActionDialog>
  <ConfirmActionDialog
    :open="acknowledge"
    :title="s('unlock')"
    :description="s('acknowledge')"
    @update:open="acknowledge = $event"
    @confirm="unlock"
  />
</template>
