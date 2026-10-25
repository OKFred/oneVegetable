<script setup lang="ts">
import type { ProductReferenceAttributes } from '@one-vegetable/core/product-reference';
import { useProductReferenceI18n } from '../i18n/product-reference';
defineProps<{ data: ProductReferenceAttributes }>();
const pr = useProductReferenceI18n();
const flag = (value: boolean | null) => (value === null ? '—' : pr(value ? 'yes' : 'no'));
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs text-muted-foreground">
      {{ pr('manualOnly') }} · {{ pr('categoryId') }} {{ data.categoryId }}
    </p>
    <section
      v-for="group in [
        { key: 'general' as const, items: data.attributes },
        { key: 'sale' as const, items: data.saleAttributes }
      ]"
      :key="group.key"
    >
      <h3 class="mb-2 font-medium">{{ pr(group.key) }}</h3>
      <p v-if="!group.items.length">—</p>
      <article
        v-for="(attribute, index) in group.items"
        :key="index"
        class="mb-2 rounded-lg border p-3 text-sm"
      >
        <h4 class="font-medium">
          {{ attribute.name || '—' }}
          <span class="text-xs text-muted-foreground">ID {{ attribute.id || '—' }}</span>
        </h4>
        <dl class="mt-2 grid grid-cols-2 gap-1">
          <dt>{{ pr('required') }}</dt>
          <dd>{{ flag(attribute.required) }}</dd>
          <dt>{{ pr('custom') }}</dt>
          <dd>{{ flag(attribute.custom) }}</dd>
          <dt>{{ pr('multiple') }}</dt>
          <dd>{{ flag(attribute.multiple) }}</dd>
          <dt>{{ pr('values') }}</dt>
          <dd>
            <ul v-if="attribute.values.length">
              <li v-for="(value, valueIndex) in attribute.values" :key="valueIndex">
                {{ value.name || '—' }} · {{ value.id || '—' }}
              </li>
            </ul>
            <span v-else>—</span>
          </dd>
        </dl>
      </article>
    </section>
  </div>
</template>
