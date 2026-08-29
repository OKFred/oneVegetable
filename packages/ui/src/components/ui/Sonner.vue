<script setup lang="ts">
import { Toaster } from 'vue-sonner';
import 'vue-sonner/style.css';

withDefaults(
  defineProps<{
    theme?: 'light' | 'dark';
  }>(),
  { theme: 'light' }
);
</script>

<template>
  <Toaster
    :theme="theme"
    position="top-right"
    rich-colors
    close-button
    :duration="4_000"
    :toast-options="{
      classes: {
        toast: 'ov-toast',
        title: 'ov-toast-title',
        description: 'ov-toast-description'
      }
    }"
  />
</template>
