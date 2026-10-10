<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { credentialExpiryState } from '../lib/credential-expiry';
import { formatDateTime } from '../lib/date-time';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
const props = defineProps<{
  expires: number | null | undefined;
  refreshExpires?: number | null | undefined;
  invalid?: boolean;
  extension?: boolean;
}>();
const t = useGatewayCredentialsI18n();
const now = ref(Date.now());
const expiry = computed(() => credentialExpiryState(props.expires, now.value));
const state = computed(() => (props.invalid ? 'invalid' : expiry.value.status));
const remaining = computed(() => t(`remaining${expiry.value.unit}`, { count: expiry.value.count }));
let timer: ReturnType<typeof globalThis.setInterval> | undefined;
onMounted(() => {
  timer = globalThis.setInterval(() => {
    now.value = Date.now();
  }, 60_000);
});
onBeforeUnmount(() => {
  if (timer) globalThis.clearInterval(timer);
});
</script>
<template>
  <section
    class="space-y-2 rounded-lg border p-3 text-sm"
    :class="
      ['expired', 'expiring', 'invalid'].includes(state)
        ? 'border-amber-500/50 bg-amber-500/10'
        : 'bg-muted/30'
    "
    data-testid="credential-expiry"
    role="status"
  >
    <p class="font-medium">
      {{ t(`expiry${state}`)
      }}<span v-if="state === 'valid' || state === 'expiring'"> · {{ remaining }}</span>
    </p>
    <p v-if="expiry.status !== 'unknown'">{{ t('expires') }}: {{ formatDateTime(expires ?? null) }}</p>
    <p v-if="refreshExpires != null">
      {{ t('refreshExpires') }}: {{ formatDateTime(refreshExpires) }} ·
      {{
        t(credentialExpiryState(refreshExpires, now).status === 'expired' ? 'expiryexpired' : 'refreshWindow')
      }}
    </p>
    <p class="text-xs leading-5 text-muted-foreground">
      {{ t(extension ? 'extensionRenew' : 'expiryHelp') }}
    </p>
  </section>
</template>
