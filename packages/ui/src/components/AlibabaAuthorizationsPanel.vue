<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Link2, RotateCw, Trash2 } from '@lucide/vue';
import type { AlibabaAuthorizationsSummary } from '@one-vegetable/core';
import { hasConfirmedAlibabaBinding } from '../lib/alibaba-authorizations';
import { formatDateTime } from '../lib/date-time';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import AlibabaAuthorizationProfile from './AlibabaAuthorizationProfile.vue';
import Card from './ui/Card.vue';
import Button from './ui/Button.vue';

const props = defineProps<{
  summary: AlibabaAuthorizationsSummary;
  selectedProtocol: 'top' | 'iop';
  busy?: boolean;
  canConfirm?: boolean;
  extension?: boolean;
  canRenew?: boolean;
  canClear?: boolean;
}>();
const emit = defineEmits<{
  select: [protocol: 'top' | 'iop'];
  confirm: [];
  renew: [protocol: 'top' | 'iop'];
  clear: [protocol: 'top' | 'iop'];
}>();
const t = useGatewayCredentialsI18n();
const sameMerchant = ref(false);
const confirmed = computed(() => hasConfirmedAlibabaBinding(props.summary));
const bindable = computed(() =>
  Boolean(
    props.summary.top?.configured &&
    props.summary.iop?.configured &&
    props.summary.top.configurationId &&
    props.summary.iop.configurationId
  )
);
const needsManagedImport = computed(
  () =>
    props.summary.top?.configured &&
    props.summary.iop?.configured &&
    (!props.summary.top.configurationId || !props.summary.iop.configurationId)
);
watch(
  () => [props.summary.top?.configurationId, props.summary.iop?.configurationId, confirmed.value],
  () => {
    sameMerchant.value = false;
  }
);
function confirm(): void {
  if (sameMerchant.value && bindable.value && props.canConfirm && !props.busy) emit('confirm');
}
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
      >
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            :disabled="busy"
            :aria-pressed="selectedProtocol === protocol"
            :data-testid="`select-authorization-${protocol}`"
            @click="emit('select', protocol)"
          >
            <Check v-if="selectedProtocol === protocol" class="size-4" aria-hidden="true" />
            <Link2 v-else class="size-4" aria-hidden="true" />{{
              t('configureProfile', { protocol: protocol.toUpperCase() })
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
    <section class="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="authorization-binding">
      <p class="font-medium" role="status">{{ t(confirmed ? 'bindingConfirmed' : 'bindingRequired') }}</p>
      <p class="leading-6 text-muted-foreground">{{ t('routingPolicy') }}</p>
      <p class="text-xs text-muted-foreground">{{ t('bindingDisclaimer') }}</p>
      <p v-if="confirmed && summary.binding.confirmedAtUtc != null" class="text-xs text-muted-foreground">
        {{ t('bindingTime', { time: formatDateTime(summary.binding.confirmedAtUtc) }) }}
      </p>
      <template v-if="!confirmed">
        <p class="text-muted-foreground">
          {{ t('unconfirmedRouting', { protocol: summary.defaultProtocol.toUpperCase() }) }}
        </p>
        <p v-if="!bindable" class="text-muted-foreground">
          {{ t(needsManagedImport ? 'bindingNeedsManaged' : 'bindingNeedsBoth') }}
        </p>
        <label class="flex items-start gap-2">
          <input
            v-model="sameMerchant"
            type="checkbox"
            class="mt-1 size-4 accent-primary"
            :disabled="busy || !bindable || !canConfirm"
            data-testid="same-merchant-confirmation"
          />
          <span>{{ t('sameMerchant') }}</span>
        </label>
        <Button
          variant="outline"
          :disabled="busy || !bindable || !canConfirm || !sameMerchant"
          data-testid="confirm-authorization-binding"
          @click="confirm"
        >
          <Link2 class="size-4" aria-hidden="true" />{{ t('confirmBinding') }}
        </Button>
      </template>
    </section>
  </Card>
</template>
