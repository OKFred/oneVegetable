<script setup lang="ts">
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';

defineProps<{ kind: 'import' | 'connection' | 'backup' }>();
const t = useGatewayCredentialsI18n();
const titles = { import: 'importActions', connection: 'connectionActions', backup: 'onlineBackup' } as const;
</script>

<template>
  <section class="space-y-3 rounded-lg border p-4" :data-testid="`credential-${kind}-actions`">
    <h3 class="text-sm font-medium">{{ t(titles[kind]) }}</h3>
    <slot />
  </section>
</template>
