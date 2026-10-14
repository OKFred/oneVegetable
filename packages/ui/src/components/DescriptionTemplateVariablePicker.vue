<script setup lang="ts">
import { Braces } from '@lucide/vue';
import {
  DESCRIPTION_TEMPLATE_VARIABLES,
  descriptionTemplateToken,
  type DescriptionTemplateVariable
} from '@one-vegetable/core/template-composition';
import { useTemplateCompositionI18n } from '../i18n/template-composition';
import Button from './ui/Button.vue';
const emit = defineEmits<{ insert: [variable: DescriptionTemplateVariable] }>();
const tc = useTemplateCompositionI18n();
</script>
<template>
  <details class="border-b bg-muted/20 p-3">
    <summary class="cursor-pointer text-sm font-medium">{{ tc('addVariable') }}</summary>
    <p class="my-3 text-xs text-muted-foreground">{{ tc('authoringHelp') }}</p>
    <div class="flex flex-wrap gap-2">
      <Button
        v-for="variable in DESCRIPTION_TEMPLATE_VARIABLES"
        :key="variable"
        variant="outline"
        size="sm"
        :aria-label="tc('insertVariable', { name: tc(`variable_${variable}`) })"
        @click="emit('insert', variable)"
      >
        <Braces class="size-4" />{{ tc(`variable_${variable}`)
        }}<code class="text-xs text-muted-foreground">{{ descriptionTemplateToken(variable) }}</code>
      </Button>
    </div>
  </details>
</template>
