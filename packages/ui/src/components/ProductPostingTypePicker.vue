<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useServices } from '../lib/services';
import { useProductPostingI18n } from '../i18n/product-posting';
import Button from './ui/Button.vue';
import ErrorNotice from './ErrorNotice.vue';

const props = defineProps<{ language: 'zh_CN' | 'en_US'; locked: boolean; categoryId: number | null }>();
const market = defineModel<'wholesale' | 'sourcing'>({ required: true });
const emit = defineEmits<{ blocked: [blocked: boolean] }>();
const { gateway } = useServices();
const s = useProductPostingI18n();
const choices = ['sourcing', 'wholesale'] as const;
const support = shallowRef<Record<(typeof choices)[number], boolean> | null>(null);
const loading = ref(false);
const error = shallowRef<unknown>(null);
let generation = 0;
const blocked = computed(() => !props.locked && (loading.value || support.value?.[market.value] === false));
watch(
  blocked,
  (value) => {
    emit('blocked', value);
  },
  { immediate: true }
);
function selectSupported(): void {
  if (props.locked || !support.value || support.value[market.value]) return;
  const available = choices.filter((choice) => support.value?.[choice]);
  if (available.length === 1 && available[0]) market.value = available[0];
}
watch(() => props.locked, selectSupported);
async function load(): Promise<void> {
  const current = ++generation;
  loading.value = true;
  support.value = null;
  error.value = null;
  if (!props.categoryId) {
    loading.value = false;
    return;
  }
  try {
    const context = await gateway.galleryTransferContext?.();
    const result = await gateway.request(
      'callCapability',
      {
        method: 'alibaba.icbu.product.type.available.get',
        parameters: { type_request: { cat_id: props.categoryId, language: props.language.toLowerCase() } }
      },
      context ? { galleryContext: context } : undefined
    );
    if (current !== generation) return;
    if (JSON.stringify(context) !== JSON.stringify(await gateway.galleryTransferContext?.()))
      throw new Error(s('invalid'));
    if (current !== generation) return;
    const data = result.data;
    if (
      !result.contractValid ||
      !data ||
      typeof data !== 'object' ||
      !('biz_success' in data) ||
      data.biz_success !== true ||
      ('msg_code' in data && typeof data.msg_code === 'string' && data.msg_code.trim() !== '') ||
      !('data' in data) ||
      !data.data ||
      typeof data.data !== 'object' ||
      !('support_post_whole_sale' in data.data) ||
      typeof data.data.support_post_whole_sale !== 'boolean' ||
      !('support_post_sourcing' in data.data) ||
      typeof data.data.support_post_sourcing !== 'boolean'
    )
      throw new Error(s('invalid'));
    support.value = {
      wholesale: data.data.support_post_whole_sale,
      sourcing: data.data.support_post_sourcing
    };
    selectSupported();
  } catch (cause) {
    if (current === generation) error.value = cause;
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch([() => props.language, () => props.categoryId], () => void load(), { immediate: true });
onBeforeUnmount(() => {
  generation++;
});
</script>
<template>
  <fieldset class="mt-4 space-y-2 rounded-lg border p-3" :aria-busy="loading">
    <legend class="px-1 text-sm font-medium">{{ s('title') }}</legend>
    <p v-if="!categoryId" class="text-sm text-muted-foreground">{{ s('chooseCategory') }}</p>
    <div class="flex flex-wrap gap-3">
      <label
        v-for="choice in choices"
        :key="choice"
        class="flex items-center gap-2 rounded-md border p-3 text-sm"
      >
        <input
          v-model="market"
          type="radio"
          name="product-posting-type"
          :value="choice"
          :disabled="locked || loading || support?.[choice] === false"
        />
        {{ s(choice) }}
        <span v-if="support?.[choice] === false" class="text-xs text-muted-foreground">{{
          s('unsupported')
        }}</span>
      </label>
    </div>
    <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ s('loading') }}</p>
    <p v-if="locked" class="text-sm text-muted-foreground">{{ s('locked') }}</p>
    <p
      v-if="support && !support.wholesale && !support.sourcing"
      role="status"
      class="text-sm text-amber-700 dark:text-amber-400"
    >
      {{ s('none') }}
    </p>
    <template v-if="error">
      <p class="text-sm text-muted-foreground">{{ s('unavailable') }}</p>
      <ErrorNotice :error="error" compact />
      <Button variant="outline" size="sm" :disabled="loading" @click="load">{{ s('retry') }}</Button>
    </template>
  </fieldset>
</template>
