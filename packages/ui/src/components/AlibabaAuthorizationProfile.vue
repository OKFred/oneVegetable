<script setup lang="ts">
import { KeyRound } from '@lucide/vue';
import type { ControlGatewayCredentialSummary } from '@one-vegetable/core';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import CredentialExpiryNotice from './CredentialExpiryNotice.vue';

defineProps<{
  protocol: 'top' | 'iop';
  summary: ControlGatewayCredentialSummary | null;
  extension?: boolean;
}>();
const t = useGatewayCredentialsI18n();
</script>

<template>
  <section
    class="min-w-0 space-y-2 rounded-lg border bg-muted/20 p-3"
    :data-testid="`authorization-${protocol}`"
  >
    <h3 class="flex items-center gap-2 text-sm font-semibold">
      <KeyRound class="size-4" aria-hidden="true" />{{ t(protocol === 'top' ? 'profileTop' : 'profileIop') }}
    </h3>
    <p class="text-sm text-muted-foreground">{{ t(summary?.configured ? 'configured' : 'empty') }}</p>
    <CredentialExpiryNotice
      v-if="summary && (summary.configured || summary.accessTokenExpiresTimeUtc != null)"
      :data-testid="`authorization-${protocol}-expiry`"
      :expires="summary.accessTokenExpiresTimeUtc"
      :captured-time="summary.accessTokenCapturedTimeUtc"
      :refresh-expires="summary.refreshTokenExpiresTimeUtc"
      :extension="extension"
    />
    <p v-if="summary?.lastRefreshErrorCode" class="text-xs text-amber-700 dark:text-amber-300" role="status">
      {{ t('refreshFailed') }}
    </p>
    <slot />
  </section>
</template>
