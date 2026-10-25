<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type {
  ProductCategorySuggestion,
  ProductReferenceAttributes,
  ProductReferenceCategory
} from '@one-vegetable/core/product-reference';
import { useProductReference } from '../composables/use-product-reference';
import { useProductReferenceI18n } from '../i18n/product-reference';
import Sheet from './ui/Sheet.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ActionTooltip from './ActionTooltip.vue';
import ErrorNotice from './ErrorNotice.vue';
import ProductReferenceAttributesView from './ProductReferenceAttributes.vue';
const props = withDefaults(
  defineProps<{
    title: string;
    description: string;
    imageUrl: string;
    /** Supplied only when the editor has confirmed this is a leaf category. */
    categoryId: string;
    disabled: boolean;
    applyCategory?: ((suggestion: ProductCategorySuggestion) => Promise<boolean>) | undefined;
  }>(),
  { applyCategory: undefined }
);
const emit = defineEmits<{ close: [] }>();
const pr = useProductReferenceI18n();
const { client, identity } = useProductReference();
const title = ref(props.title);
const description = ref(props.description);
const imageUrl = ref(props.imageUrl);
const suggestion = ref<ProductCategorySuggestion | null>(null);
const path = ref<ProductReferenceCategory[]>([]);
const categories = ref<ProductReferenceCategory[]>([]);
const knownLeafIds = ref<string[]>([]);
const attributes = ref<ProductReferenceAttributes | null>(null);
const browseLoaded = ref(false);
const busy = ref(false);
const error = ref<unknown>(null);
let sequence = 0;
const imageValid = computed(() => {
  if (!imageUrl.value.trim()) return true;
  try {
    const url = new URL(imageUrl.value.trim());
    const hostname = url.hostname.toLocaleLowerCase();
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (hostname === 'alicdn.com' || hostname.endsWith('.alicdn.com'))
    );
  } catch {
    return false;
  }
});
const signature = computed(() =>
  JSON.stringify([title.value.trim(), description.value.trim(), imageUrl.value.trim()])
);
watch(signature, () => {
  suggestion.value = null;
});
async function run(action: (current: () => boolean) => Promise<void>): Promise<void> {
  if (busy.value) return;
  const captured = ++sequence;
  busy.value = true;
  error.value = null;
  try {
    await action(() => captured === sequence);
  } catch (cause: unknown) {
    if (captured === sequence) error.value = cause;
  } finally {
    if (captured === sequence) busy.value = false;
  }
}
function predict(): void {
  if (!title.value.trim() || !imageValid.value) return;
  const captured = signature.value;
  suggestion.value = null;
  void run(async (current) => {
    const result = await client.predictCategory({
      title: title.value.trim(),
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
      ...(imageUrl.value.trim() ? { imageUrl: imageUrl.value.trim() } : {})
    });
    if (current() && captured === signature.value) suggestion.value = result;
  });
}
function browse(nextPath: ProductReferenceCategory[] = []): void {
  void run(async (current) => {
    const result = await client.listCategories(nextPath.at(-1)?.id);
    if (current()) {
      categories.value = result;
      knownLeafIds.value = [
        ...new Set([
          ...knownLeafIds.value.filter((id) => !result.some((category) => category.id === id)),
          ...result.filter((category) => category.leaf === true).map((category) => category.id)
        ])
      ];
      path.value = nextPath;
      browseLoaded.value = true;
    }
  });
}
function isKnownLeaf(categoryId: string): boolean {
  // The public prediction contract explicitly defines category_id as a leaf ID.
  // A current signed prediction is sufficient for a read; don't scan the whole tree.
  return (
    Boolean(categoryId) &&
    (categoryId === props.categoryId ||
      categoryId === suggestion.value?.categoryId ||
      knownLeafIds.value.includes(categoryId))
  );
}
function inspect(categoryId: string): void {
  if (!isKnownLeaf(categoryId)) return;
  attributes.value = null;
  void run(async (current) => {
    const result = await client.getAttributes(categoryId);
    if (current()) attributes.value = result;
  });
}
function propose(category: ProductReferenceCategory): void {
  if (category.leaf !== true) return;
  suggestion.value = {
    categoryId: category.id,
    categoryName: category.name,
    categoryPath: [...path.value, category].map((item) => item.name).join(' / ')
  };
}
function confirm(): void {
  const choice = suggestion.value;
  if (!choice || props.disabled || !props.applyCategory) return;
  void run(async (current) => {
    if (await props.applyCategory?.(choice)) {
      if (current()) emit('close');
    }
  });
}
watch(
  identity,
  () => {
    sequence++;
    suggestion.value = null;
    categories.value = [];
    knownLeafIds.value = [];
    attributes.value = null;
    busy.value = false;
    error.value = null;
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
    :title="pr('assistance')"
    :description="pr('readOnly')"
    @update:open="!$event && emit('close')"
  >
    <div class="space-y-5">
      <p class="text-sm text-muted-foreground">{{ pr('recommendHint') }}</p>
      <label class="block space-y-1 text-sm"
        ><span>{{ pr('enteredTitle') }}</span
        ><Input v-model="title" :aria-label="pr('enteredTitle')"
      /></label>
      <label class="block space-y-1 text-sm"
        ><span>{{ pr('optionalDescription') }}</span
        ><textarea
          v-model="description"
          rows="3"
          class="w-full rounded-md border bg-background p-2"
          :aria-label="pr('optionalDescription')"
        />
      </label>
      <label class="block space-y-1 text-sm"
        ><span>{{ pr('imageUrl') }}</span
        ><Input v-model="imageUrl" :aria-label="pr('imageUrl')" :aria-invalid="!imageValid"
      /></label>
      <p v-if="!imageValid" role="alert" class="text-sm text-destructive">{{ pr('invalidImage') }}</p>
      <div class="flex flex-wrap gap-2">
        <ActionTooltip
          :disabled="!title.trim() || !imageValid"
          :reason="!imageValid ? pr('invalidImage') : pr('enteredTitle')"
          ><Button size="sm" :disabled="busy || !title.trim() || !imageValid" @click="predict">{{
            pr('recommend')
          }}</Button></ActionTooltip
        >
        <Button size="sm" variant="outline" :disabled="busy" @click="browse()">{{ pr('browse') }}</Button>
        <Button
          v-if="isKnownLeaf(categoryId)"
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="inspect(categoryId)"
          >{{ pr('attributes') }}</Button
        >
      </div>
      <p v-if="busy" role="status">{{ pr('loading') }}</p>
      <ErrorNotice v-if="error" :error="error" :fallback="pr('failed')" compact />
      <section v-if="suggestion" class="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
        <h3 class="font-medium">{{ pr('suggestion') }}</h3>
        <p class="break-words text-sm">{{ suggestion.categoryPath || suggestion.categoryName || '—' }}</p>
        <p class="text-xs">{{ pr('categoryId') }} {{ suggestion.categoryId }}</p>
        <p class="text-xs text-muted-foreground">{{ pr('confirmHint') }}</p>
        <div class="flex flex-wrap gap-2">
          <Button v-if="!disabled && applyCategory" size="sm" :disabled="busy" @click="confirm">{{
            pr('confirm')
          }}</Button>
          <Button
            v-if="isKnownLeaf(suggestion.categoryId)"
            size="sm"
            variant="outline"
            :disabled="busy"
            @click="inspect(suggestion.categoryId)"
            >{{ pr('attributes') }}</Button
          >
        </div>
      </section>
      <section v-if="browseLoaded" class="space-y-3 rounded-lg border p-3">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant="outline" :disabled="busy || !path.length" @click="browse([])">{{
            pr('root')
          }}</Button>
          <Button
            v-if="path.length"
            size="sm"
            variant="outline"
            :disabled="busy"
            @click="browse(path.slice(0, -1))"
            >{{ pr('back') }}</Button
          >
          <span>{{ path.map((item) => item.name).join(' / ') || pr('root') }}</span>
        </div>
        <p v-if="!categories.length">{{ pr('empty') }}</p>
        <ul class="space-y-2">
          <li v-for="category in categories" :key="category.id" class="rounded-lg border p-3">
            <p class="text-sm font-medium">{{ category.name || '—' }}</p>
            <p class="mt-1 text-xs text-muted-foreground">ID {{ category.id }}</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <Button
                v-if="category.leaf !== true"
                size="sm"
                variant="outline"
                :disabled="busy"
                @click="browse([...path, category])"
                >{{ pr('children') }}</Button
              >
              <Button v-else-if="!disabled" size="sm" :disabled="busy" @click="propose(category)">{{
                pr('suggestion')
              }}</Button>
              <Button
                v-if="category.leaf === true"
                size="sm"
                variant="outline"
                :disabled="busy"
                @click="inspect(category.id)"
                >{{ pr('attributes') }}</Button
              >
            </div>
          </li>
        </ul>
      </section>
      <ProductReferenceAttributesView v-if="attributes" :data="attributes" />
    </div>
  </Sheet>
</template>
