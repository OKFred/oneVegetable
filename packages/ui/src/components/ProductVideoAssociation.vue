<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Video } from '@one-vegetable/core/video';
import { useProductVideoAssociation, type VideoAssociationIntent } from '../lib/product-video-association';
import { useVideoI18n } from '../i18n/video';
import { GATEWAY_CONFIGURATION_EVENT } from '../lib/gateway-configuration-events';
import { VIDEO_ASSOCIATION_PREFIX } from '../lib/video-association-storage';
import VideoPicker from './VideoPicker.vue';
import VideoDrawer from './VideoDrawer.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ActionTooltip from './ActionTooltip.vue';
import Button from './ui/Button.vue';
import PlatformReadbackNotice from './PlatformReadbackNotice.vue';

const props = withDefaults(
  defineProps<{
    productId: string;
    language: 'zh_CN' | 'en_US';
    blocked?: boolean;
    preset?: { video: Video; identity: string } | null;
  }>(),
  { blocked: false, preset: null }
);
const emit = defineEmits<{ busy: [value: boolean] }>();
const vt = useVideoI18n();
const association = useProductVideoAssociation(() => props);
const { receipt, identity, allowed, verifyAllowed, busy, loading, error, unresolved } = association;
const open = ref(false),
  type = ref<'main' | 'detail'>('main');
const selected = shallowRef<Video | null>(null),
  preview = shallowRef<Video | null>(null);
const pending = shallowRef<VideoAssociationIntent | null>(null);
const existing = computed(() => /^[1-9][0-9]*$/.test(props.productId));
const disabledReason = computed(() => {
  if (props.preset && identity.value !== props.preset.identity) return vt('associationBlocked');
  if (!allowed.value) return vt('associationUnavailable');
  if (busy.value || loading.value || props.blocked) return vt('associationBlocked');
  if (unresolved.value) return vt('associationUnknown');
  if (!selected.value) return vt('associationSelectFirst');
  return '';
});
function prepare() {
  if (!disabledReason.value && selected.value)
    pending.value = association.prepare(selected.value, type.value);
}
async function confirm() {
  const intent = pending.value;
  if (!intent) return;
  pending.value = null;
  await association.submit(intent);
}
function reset() {
  selected.value = preview.value = pending.value = null;
  open.value = false;
  association.invalidate();
  void association.load();
}
function storageChanged(event: StorageEvent) {
  if (!event.key || event.key.startsWith(VIDEO_ASSOCIATION_PREFIX)) reset();
}
function visibilityChanged() {
  selected.value = preview.value = pending.value = null;
  open.value = false;
  association.invalidate();
  if (globalThis.document.visibilityState === 'visible') void association.load();
}
watch([() => props.productId, () => props.language], reset, { immediate: true });
watch(
  busy,
  (value) => {
    emit('busy', value);
  },
  { flush: 'sync', immediate: true }
);
watch(
  identity,
  () => {
    selected.value = preview.value = pending.value = null;
    open.value = false;
  },
  { flush: 'sync' }
);
watch(
  [identity, loading, () => props.preset],
  () => {
    if (!loading.value && identity.value === props.preset?.identity) selected.value = props.preset.video;
  },
  { immediate: true }
);
onMounted(() => {
  globalThis.addEventListener('focus', reset);
  globalThis.addEventListener('storage', storageChanged);
  globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, reset);
  globalThis.document.addEventListener('visibilitychange', visibilityChanged);
});
onBeforeUnmount(() => {
  globalThis.removeEventListener('focus', reset);
  globalThis.removeEventListener('storage', storageChanged);
  globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, reset);
  globalThis.document.removeEventListener('visibilitychange', visibilityChanged);
});
const statusText = computed(() =>
  receipt.value
    ? vt(
        (
          {
            sending: 'associationSending',
            unknown: 'associationUnknown',
            unconfirmed: 'associationUnconfirmed',
            confirmed: 'associationConfirmed',
            rejected: 'associationRejected'
          } as const
        )[receipt.value.state]
      )
    : ''
);
</script>
<template>
  <section
    v-if="existing"
    class="my-4 space-y-3 rounded-lg border p-4"
    data-testid="product-video-association"
  >
    <h3 class="font-semibold">{{ vt('associationTitle') }}</h3>
    <p class="text-sm text-muted-foreground">{{ vt('associationNotice') }}</p>
    <Button v-if="!preset" variant="outline" :disabled="busy || loading || !identity" @click="open = !open">{{
      vt('associationChoose')
    }}</Button>
    <VideoPicker
      v-if="open && identity"
      :identity="identity"
      :language="language"
      :disabled="busy"
      @select="
        selected = $event;
        open = false;
      "
    />
    <div v-if="selected" class="flex flex-wrap items-center gap-3">
      <p>
        {{ selected.title ?? '—' }} · <code>{{ selected.id }}</code>
      </p>
      <Button variant="outline" @click="preview = selected">{{ vt('view') }}</Button>
      <label
        >{{ vt('associationType') }}
        <select
          v-model="type"
          class="ml-2 rounded border bg-background p-2"
          :disabled="busy || !!pending"
          :aria-label="vt('associationType')"
        >
          <option value="main">{{ vt('main') }}</option>
          <option value="detail">{{ vt('detail') }}</option>
        </select>
      </label>
    </div>
    <ActionTooltip :disabled="!!disabledReason" :reason="disabledReason">
      <Button data-testid="associate-video" :disabled="!!disabledReason" @click="prepare">{{
        vt('associationApply')
      }}</Button>
    </ActionTooltip>
    <p v-if="error" role="alert">{{ vt(error) }}</p>
    <div
      v-if="receipt"
      class="space-y-2 rounded border p-3 text-sm"
      data-testid="video-association-receipt"
      aria-live="polite"
    >
      <p>{{ statusText }}</p>
      <PlatformReadbackNotice v-if="['unknown', 'unconfirmed'].includes(receipt.state)" kind="unconfirmed" />
      <p>{{ vt(receipt.request.type) }} · {{ receipt.request.productId }} → {{ receipt.request.videoId }}</p>
      <p class="break-all">requestId: {{ receipt.requestId }}</p>
      <p v-if="receipt.traceId" class="break-all">traceId: {{ receipt.traceId }}</p>
      <p v-if="receipt.code" class="break-all">{{ receipt.code }}</p>
      <ActionTooltip
        v-if="unresolved"
        :disabled="!verifyAllowed"
        :reason="vt('associationVerifyUnavailable')"
      >
        <Button
          data-testid="verify-video"
          variant="outline"
          :disabled="busy || loading || !verifyAllowed"
          @click="association.verify"
          >{{ vt('associationVerify') }}</Button
        >
      </ActionTooltip>
    </div>
    <Button variant="outline" :disabled="busy || loading" @click="reset">{{
      vt('associationRefresh')
    }}</Button>
    <VideoDrawer :video="preview" :identity="identity" @close="preview = null" />
    <ConfirmActionDialog
      :open="!!pending"
      :title="vt('associationApply')"
      :description="vt('associationConfirmNotice')"
      :pending="busy"
      @update:open="!$event && (pending = null)"
      @confirm="confirm"
    >
      <template v-if="pending"
        ><p>
          {{ vt(pending.request.type) }} · {{ pending.request.productId }} → {{ pending.request.videoId }}
        </p>
        <p class="break-all">{{ vt('encryptedId') }}: {{ pending.request.encryptedVideoId }}</p></template
      >
    </ConfirmActionDialog>
  </section>
</template>
