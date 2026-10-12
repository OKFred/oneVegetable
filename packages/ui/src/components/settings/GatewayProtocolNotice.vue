<script setup lang="ts">
import { useGatewayCredentialsI18n } from '../../i18n/gateway-credentials';

defineProps<{ protocol?: 'top' | 'iop' | undefined }>();
const t = useGatewayCredentialsI18n();
</script>

<template>
  <p v-if="protocol === 'iop'" class="text-sm text-muted-foreground" data-testid="iop-protocol-notice">
    {{ t('iopCompatibility') }}
  </p>
</template>
