<script setup lang="ts">
defineEmits<{ search: [] }>();
</script>

<template>
  <div class="grid min-w-0 gap-2 rounded-t-lg border border-b-0 p-2">
    <form
      v-if="$slots.search"
      data-slot="list-toolbar-search"
      class="flex min-w-0 items-center gap-2"
      @submit.prevent="$emit('search')"
    >
      <slot name="search" />
    </form>
    <div
      v-if="$slots.actions"
      data-slot="list-toolbar-actions"
      class="flex min-w-0 flex-wrap items-center justify-end gap-2"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
