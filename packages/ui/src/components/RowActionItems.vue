<script setup lang="ts">
import { provide } from 'vue';
import { rowActionButtonContext } from '../lib/button-context';

provide(rowActionButtonContext, true);
</script>

<template>
  <div data-row-actions class="row-actions flex flex-col gap-1"><slot /></div>
</template>
