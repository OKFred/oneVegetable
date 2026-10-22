<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { Cloud, ExternalLink } from '@lucide/vue';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import { useServices } from '../lib/services';
import Button from './ui/Button.vue';

const props = defineProps<{ protocol: 'top' | 'iop' }>();
const emit = defineEmits<{ completed: []; dialogChanged: [open: boolean] }>();
const t = useGatewayCredentialsI18n();
const { control, runtime } = useServices();
const cloudOpen = ref(false);
const canUseCloud = computed(
  () =>
    props.protocol === 'top' &&
    runtime?.backendMeta?.runtime === 'cloudflare' &&
    typeof control?.startAlibabaCredentialAcquisition === 'function'
);
const CloudAcquisitionDialog = defineAsyncComponent(
  () => import('./AlibabaCloudCredentialAcquisitionDialog.vue')
);

function changeCloudDialog(open: boolean): void {
  cloudOpen.value = open;
  emit('dialogChanged', open);
}
</script>

<template>
  <section
    class="space-y-3 rounded-lg border bg-muted/30 p-4"
    data-testid="gateway-authorization-setup-guide"
  >
    <h3 class="text-sm font-medium">{{ t('webSetupTitle', { protocol: protocol.toUpperCase() }) }}</h3>
    <p class="text-sm leading-6 text-muted-foreground">{{ t('webSetupDescription') }}</p>
    <ol class="list-decimal space-y-2 pl-5 text-sm leading-6">
      <li>{{ t('webSetupInstall') }}</li>
      <li>{{ t('webSetupAuthorize', { protocol: protocol.toUpperCase() }) }}</li>
      <li>{{ t('webSetupImport') }}</li>
    </ol>
    <p class="text-xs leading-5 text-muted-foreground">
      {{ t(protocol === 'iop' ? 'chooseProtocolIopHelp' : 'chooseProtocolTopHelp') }}
    </p>
    <div class="flex flex-wrap gap-2">
      <a
        href="https://chromewebstore.google.com/detail/aepfdoldflokikbbcpnfifkacpfakmjc"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ExternalLink class="size-4" aria-hidden="true" />{{ t('webSetupStore') }}
      </a>
      <a
        href="https://youtu.be/-Y3xLY_dJIA"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ExternalLink class="size-4" aria-hidden="true" />{{ t('webSetupTutorial') }}
      </a>
    </div>
    <details v-if="canUseCloud" class="rounded-md border p-3 text-sm">
      <summary class="cursor-pointer font-medium">{{ t('webSetupCloudOptions') }}</summary>
      <p class="my-3 text-xs leading-5 text-muted-foreground">{{ t('webSetupCloudNotice') }}</p>
      <Button variant="outline" @click="changeCloudDialog(true)">
        <Cloud class="size-4" aria-hidden="true" />{{ t('webSetupCloudTop') }}
      </Button>
    </details>
    <CloudAcquisitionDialog
      v-if="cloudOpen && canUseCloud"
      :open="cloudOpen"
      @update:open="changeCloudDialog"
      @completed="emit('completed')"
    />
  </section>
</template>
