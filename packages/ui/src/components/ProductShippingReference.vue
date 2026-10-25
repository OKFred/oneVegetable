<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import type { ProductReferenceShippingTemplate } from '@one-vegetable/core/product-reference';
import { useProductReference } from '../composables/use-product-reference';
import { useProductReferenceI18n } from '../i18n/product-reference';
import Sheet from './ui/Sheet.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ErrorNotice from './ErrorNotice.vue';
const emit = defineEmits<{ close: [] }>();
const pr = useProductReferenceI18n();
const { client, identity } = useProductReference();
const templates = ref<ProductReferenceShippingTemplate[]>([]);
const search = ref('');
const busy = ref(false);
const loaded = ref(false);
const error = ref<unknown>(null);
let sequence = 0;
const visible = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return templates.value.filter(
    (item) => !query || [item.id, item.name].some((value) => value?.toLocaleLowerCase().includes(query))
  );
});
async function load(): Promise<void> {
  const current = ++sequence;
  busy.value = true;
  templates.value = [];
  error.value = null;
  try {
    const data = await client.listShippingTemplates();
    if (current === sequence) {
      templates.value = data;
      loaded.value = true;
    }
  } catch (cause: unknown) {
    if (current === sequence) error.value = cause;
  } finally {
    if (current === sequence) busy.value = false;
  }
}
async function copy(id: string): Promise<void> {
  const current = sequence;
  try {
    await globalThis.navigator.clipboard.writeText(id);
    if (current === sequence) toast.success(pr('copied'));
  } catch {
    if (current === sequence) toast.error(pr('copyFailed'));
  }
}
watch(
  identity,
  () => {
    sequence++;
    templates.value = [];
    loaded.value = false;
    busy.value = false;
    error.value = null;
    emit('close');
  },
  { flush: 'sync' }
);
onScopeDispose(() => {
  sequence++;
});
void load();
</script>

<template>
  <Sheet
    :open="true"
    :title="pr('shipping')"
    :description="pr('readOnly')"
    @update:open="!$event && emit('close')"
  >
    <div class="space-y-4">
      <p class="text-sm text-muted-foreground">{{ pr('shippingHint') }}</p>
      <p v-if="busy" role="status">{{ pr('loading') }}</p>
      <template v-else-if="error"
        ><ErrorNotice :error="error" :fallback="pr('failed')" compact /><Button size="sm" @click="load">{{
          pr('retry')
        }}</Button></template
      >
      <template v-else-if="loaded">
        <Input v-model="search" :aria-label="pr('search')" :placeholder="pr('search')" />
        <p v-if="!visible.length" role="status">{{ pr('empty') }}</p>
        <ul class="space-y-2">
          <li
            v-for="item in visible"
            :key="item.id"
            class="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div class="min-w-0">
              <p class="break-words text-sm">{{ item.name || '—' }}</p>
              <p class="select-text break-all font-mono text-xs">{{ item.id }}</p>
            </div>
            <Button size="sm" @click="copy(item.id)">{{ pr('copy') }}</Button>
          </li>
        </ul>
      </template>
    </div>
  </Sheet>
</template>
