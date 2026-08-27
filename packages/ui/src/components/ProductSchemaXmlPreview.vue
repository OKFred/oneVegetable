<script setup lang="ts">
import type { ProductSchemaSerializationInspection } from '@one-vegetable/core';

defineProps<{
  changedFieldNames: string[];
  inspection: ProductSchemaSerializationInspection;
  xml: string;
}>();
</script>

<template>
  <p v-if="changedFieldNames.length" class="mt-3 text-xs text-muted-foreground">
    实际变化字段：{{ changedFieldNames.join('、') }}
  </p>
  <div v-if="!inspection.safe" class="mt-3 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
    <p v-for="diff in inspection.structuralDiffs" :key="diff">{{ diff }}</p>
  </div>
  <pre class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap bg-slate-950 p-3 text-xs text-slate-100">{{
    xml
  }}</pre>
</template>
