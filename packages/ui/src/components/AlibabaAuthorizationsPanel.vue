<script setup lang="ts">
import { computed } from 'vue';
import { Check, Link2, RotateCw, Trash2 } from '@lucide/vue';
import type { AlibabaAuthorizationsSummary } from '@one-vegetable/core';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import AlibabaAuthorizationProfile from './AlibabaAuthorizationProfile.vue';
import Card from './ui/Card.vue';
import Button from './ui/Button.vue';

const props = withDefaults(
  defineProps<{
    summary: AlibabaAuthorizationsSummary;
    selectedProtocol: 'top' | 'iop';
    busy?: boolean;
    configureBusy?: boolean | undefined;
    canConfirm?: boolean;
    extension?: boolean;
    canRenew?: boolean;
    canClear?: boolean;
    canSetDefault?: boolean;
    compact?: boolean;
    configureActions?: boolean;
  }>(),
  { configureBusy: undefined }
);
const emit = defineEmits<{
  select: [protocol: 'top' | 'iop'];
  setDefault: [protocol: 'top' | 'iop'];
  confirm: [];
  renew: [protocol: 'top' | 'iop'];
  clear: [protocol: 'top' | 'iop'];
}>();
const t = useGatewayCredentialsI18n();
const automatic = computed(() => Boolean(props.summary.top?.configured && props.summary.iop?.configured));
</script>

<template>
  <Card class="space-y-4 p-5" data-testid="alibaba-authorizations-panel" :aria-busy="busy">
    <h2 class="flex items-center gap-2 font-semibold">
      <Link2 class="size-4" aria-hidden="true" />{{ t('dualTitle') }}
    </h2>
    <p class="text-sm leading-6 text-muted-foreground">{{ t('dualDescription') }}</p>
    <div class="grid gap-3 lg:grid-cols-2" role="group" :aria-label="t('selectProfile')">
      <AlibabaAuthorizationProfile
        v-for="protocol in ['top', 'iop'] as const"
        :key="protocol"
        :protocol="protocol"
        :summary="summary[protocol]"
        :extension="extension"
        :compact="compact"
      >
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="canSetDefault"
            variant="outline"
            :disabled="busy || !summary[protocol]?.configured || !summary[protocol]?.configurationId"
            :aria-pressed="summary.defaultProtocol === protocol && !!summary[protocol]?.configured"
            :data-testid="`default-authorization-${protocol}`"
            @click="emit('setDefault', protocol)"
          >
            <Check
              v-if="summary.defaultProtocol === protocol && summary[protocol]?.configured"
              class="size-4"
              aria-hidden="true"
            />
            <Link2 v-else class="size-4" aria-hidden="true" />
            {{
              t(
                summary.defaultProtocol === protocol && summary[protocol]?.configured
                  ? 'defaultSelected'
                  : 'setDefault'
              )
            }}
          </Button>
          <Button
            v-if="!canSetDefault || configureActions"
            variant="outline"
            :disabled="configureBusy ?? busy"
            :aria-pressed="configureActions ? undefined : selectedProtocol === protocol"
            :data-testid="`select-authorization-${protocol}`"
            @click="emit('select', protocol)"
          >
            <Check
              v-if="!configureActions && selectedProtocol === protocol"
              class="size-4"
              aria-hidden="true"
            />
            <Link2 v-else class="size-4" aria-hidden="true" />{{
              t(configureActions && summary[protocol]?.configured ? 'updateProfile' : 'configureProfile', {
                protocol: protocol.toUpperCase()
              })
            }}
          </Button>
          <Button
            v-if="canRenew"
            variant="outline"
            :disabled="busy || !summary[protocol]?.canRefresh"
            :data-testid="`renew-authorization-${protocol}`"
            @click="emit('renew', protocol)"
          >
            <RotateCw class="size-4" aria-hidden="true" />{{ t('renew') }}
          </Button>
          <Button
            v-if="canClear"
            variant="outline"
            :disabled="busy || !summary[protocol]?.configured"
            :data-testid="`clear-authorization-${protocol}`"
            @click="emit('clear', protocol)"
          >
            <Trash2 class="size-4" aria-hidden="true" />{{ t('clear') }}
          </Button>
        </div>
      </AlibabaAuthorizationProfile>
    </div>
    <component
      :is="compact ? 'details' : 'section'"
      class="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm"
      data-testid="authorization-binding"
    >
      <component
        :is="compact ? 'summary' : 'p'"
        class="font-medium"
        :class="compact ? 'cursor-pointer' : undefined"
        :role="compact ? undefined : 'status'"
      >
        {{
          automatic
            ? t('automaticRouting')
            : t('singleRouting', { protocol: summary.defaultProtocol.toUpperCase() })
        }}
      </component>
      <p class="leading-6 text-muted-foreground">{{ t('routingPolicy') }}</p>
      <p class="text-xs text-muted-foreground">{{ t('routingOwnership') }}</p>
    </component>
  </Card>
</template>
