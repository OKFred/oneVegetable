<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { ProductReference } from '@one-vegetable/core/product-reference';
import { useProductReference } from '../composables/use-product-reference';
import { useProductReferenceI18n } from '../i18n/product-reference';
import { productReferenceAuditStateLabel, productReferenceOnlineStateLabel } from '../lib/product-status';
import Sheet from './ui/Sheet.vue';
import Button from './ui/Button.vue';
import SafeHtmlContent from './SafeHtmlContent.vue';
import ErrorNotice from './ErrorNotice.vue';

const props = defineProps<{ productId: string }>();
const emit = defineEmits<{ close: [] }>();
const pr = useProductReferenceI18n();
const { client, identity } = useProductReference();
const data = ref<ProductReference | null>(null);
const busy = ref(false);
const error = ref<unknown>(null);
let sequence = 0;
function text(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  return value;
}
const general = computed(() => {
  const p = data.value;
  return p
    ? [
        [pr('title'), text(p.title)],
        [pr('keywords'), text(p.keywords)],
        [pr('categoryPath'), text(p.categoryPath)],
        [pr('categoryId'), text(p.categoryId)],
        [pr('language'), text(p.language)],
        [pr('model'), text(p.modelNumber)],
        [pr('created'), text(p.createdTimestamp)],
        [pr('modified'), text(p.modifiedTimestamp)]
      ]
    : [];
});
const shipping = computed(() => {
  const p = data.value;
  return p
    ? [
        [pr('shippingId'), text(p.shippingTemplateId)],
        [pr('weight'), text(p.weight)],
        [pr('dimensions'), [p.dimension.length, p.dimension.width, p.dimension.height].map(text).join(' × ')],
        [pr('moq'), text(p.moq)],
        [pr('unit'), text(p.unit)]
      ]
    : [];
});
async function load(): Promise<void> {
  const current = ++sequence;
  data.value = null;
  error.value = null;
  busy.value = true;
  try {
    const result = await client.getProduct(props.productId);
    if (current === sequence) data.value = result;
  } catch (cause: unknown) {
    if (current === sequence) error.value = cause;
  } finally {
    if (current === sequence) busy.value = false;
  }
}
watch(
  () => props.productId,
  () => void load(),
  { immediate: true }
);
watch(
  identity,
  () => {
    sequence++;
    data.value = null;
    error.value = null;
    busy.value = false;
    emit('close');
  },
  { flush: 'sync' }
);
onScopeDispose(() => {
  sequence++;
});
</script>

<template>
  <Sheet
    :open="true"
    :title="pr('view')"
    :description="pr('readOnly')"
    @update:open="!$event && emit('close')"
  >
    <div class="space-y-5">
      <p class="text-xs text-muted-foreground">ID {{ productId }}</p>
      <p v-if="busy" role="status">{{ pr('loading') }}</p>
      <div v-else-if="error" class="space-y-3">
        <ErrorNotice :error="error" :fallback="pr('failed')" compact />
        <Button size="sm" @click="load">{{ pr('retry') }}</Button>
      </div>
      <template v-else-if="data">
        <dl class="grid gap-3 sm:grid-cols-2">
          <div v-for="[label, value] in general" :key="label" class="min-w-0">
            <dt class="text-xs text-muted-foreground">{{ label }}</dt>
            <dd class="break-words text-sm">{{ value }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">{{ pr('onlineState') }}</dt>
            <dd>{{ productReferenceOnlineStateLabel(data.status) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">{{ pr('auditState') }}</dt>
            <dd>{{ productReferenceAuditStateLabel(data.auditStatus) }}</dd>
          </div>
        </dl>
        <p class="text-xs text-muted-foreground">{{ pr('timestampHint') }}</p>
        <section class="rounded-lg border p-3">
          <h3 class="mb-2 font-medium">{{ pr('general') }}</h3>
          <dl v-if="data.attributes.length" class="space-y-2 text-sm">
            <div v-for="(attribute, index) in data.attributes" :key="index" class="grid grid-cols-2 gap-2">
              <dt>{{ text(attribute.name) }}</dt>
              <dd class="break-words">{{ text(attribute.value) }}</dd>
            </div>
          </dl>
          <p v-else>—</p>
        </section>
        <section class="rounded-lg border p-3">
          <h3 class="mb-2 font-medium">{{ pr('price') }}</h3>
          <dl class="grid grid-cols-2 gap-2 text-sm">
            <dt>{{ pr('priceType') }}</dt>
            <dd>{{ text(data.price.type) }}</dd>
            <dt>{{ pr('currency') }}</dt>
            <dd>{{ text(data.price.currency) }}</dd>
            <dt>{{ pr('price') }}</dt>
            <dd>{{ text(data.price.min) }} – {{ text(data.price.max) }}</dd>
            <dt>{{ pr('inventory') }}</dt>
            <dd>{{ text(data.inventory) }}</dd>
          </dl>
          <table v-if="data.price.tiers.length" class="mt-3 w-full text-left text-sm">
            <thead>
              <tr>
                <th>{{ pr('quantity') }}</th>
                <th>{{ pr('price') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(tier, index) in data.price.tiers" :key="index">
                <td>{{ text(tier.quantity) }}</td>
                <td>{{ text(tier.price) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3 class="mb-2 font-medium">{{ pr('skus') }}</h3>
          <p v-if="!data.skus.length">—</p>
          <article v-for="(sku, index) in data.skus" :key="index" class="mb-3 rounded-lg border p-3 text-sm">
            <dl class="grid grid-cols-2 gap-2">
              <dt>SKU ID</dt>
              <dd class="break-all">{{ text(sku.id) }}</dd>
              <dt>{{ pr('code') }}</dt>
              <dd>{{ text(sku.code) }}</dd>
              <dt>{{ pr('price') }}</dt>
              <dd>{{ text(sku.currency) }} {{ text(sku.price) }}</dd>
              <dt>{{ pr('inventory') }}</dt>
              <dd>{{ text(sku.inventory) }}</dd>
            </dl>
            <h4 class="mb-1 mt-3 text-xs font-medium text-muted-foreground">{{ pr('sale') }}</h4>
            <dl v-if="sku.attributes.length" class="space-y-1">
              <div
                v-for="(attribute, attrIndex) in sku.attributes"
                :key="attrIndex"
                class="grid grid-cols-2 gap-2"
              >
                <dt>{{ text(attribute.name) }}</dt>
                <dd>{{ text(attribute.value) }}</dd>
              </div>
            </dl>
            <p v-else>—</p>
          </article>
        </section>
        <section class="rounded-lg border p-3">
          <h3 class="mb-2 font-medium">{{ pr('logistics') }}</h3>
          <dl class="grid grid-cols-2 gap-2 text-sm">
            <template v-for="[label, value] in shipping" :key="label"
              ><dt>{{ label }}</dt>
              <dd class="break-all">{{ value }}</dd></template
            >
          </dl>
          <table v-if="data.leadTimes.length" class="mt-3 w-full text-left text-sm">
            <thead>
              <tr>
                <th>{{ pr('quantity') }}</th>
                <th>{{ pr('leadTime') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(lead, index) in data.leadTimes" :key="index">
                <td>{{ text(lead.quantity) }}</td>
                <td>{{ text(lead.days) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="overflow-hidden rounded-lg border p-3">
          <h3 class="mb-2 font-medium">{{ pr('description') }}</h3>
          <SafeHtmlContent v-if="data.descriptionHtml" :html="data.descriptionHtml" />
          <p v-else>—</p>
        </section>
      </template>
    </div>
  </Sheet>
</template>
