<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ArrowLeft, ArrowRight, FileUp, Globe } from '@lucide/vue';
import { toast } from 'vue-sonner';
import {
  validateVaultPassphrase,
  type CredentialVaultRepository,
  type CredentialVaultStatus
} from '@one-vegetable/core';
import {
  parseAlibabaCredentialImport,
  type AlibabaOpenApiCredentialBundle
} from '@one-vegetable/core/credential-bundle';
import type { ExtensionAlibabaCredentialAcquisitionRepository } from '@one-vegetable/core';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import { useUiI18n } from '../i18n';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import AlibabaAuthorizationGuide from './AlibabaAuthorizationGuide.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    purpose?: 'acquire' | 'renew';
    vault?: CredentialVaultRepository | undefined;
    acquisition?: ExtensionAlibabaCredentialAcquisitionRepository | undefined;
    beforeImport?: (() => Promise<boolean>) | undefined;
    initialFile?: File | undefined;
    protocol?: 'top' | 'iop' | undefined;
    showGuide?: boolean;
  }>(),
  {
    purpose: 'acquire',
    vault: undefined,
    acquisition: undefined,
    beforeImport: undefined,
    initialFile: undefined,
    protocol: undefined,
    showGuide: false
  }
);
const emit = defineEmits<{
  'update:open': [open: boolean];
  select: [protocol: 'top' | 'iop'];
  prepared: [status: CredentialVaultStatus];
  imported: [status: CredentialVaultStatus];
}>();
const text = useGatewayCredentialsI18n();
const { t } = useUiI18n();
type Phase = 'guide' | 'checking' | 'protection' | 'methods' | 'file' | 'choices' | 'error';
const phase = ref<Phase>('checking');
const history = ref<Phase[]>([]);
const initialFileConsumed = ref(false);
const pendingBundles = shallowRef<AlibabaOpenApiCredentialBundle[]>([]);
const fileName = ref('');
const fileInput = ref<HTMLInputElement>();
const importing = ref(false);
const canImport = computed(
  () => props.purpose === 'acquire' && !!(props.acquisition?.importBundle ?? props.acquisition?.importBundles)
);
const readyPhase = () => (canImport.value ? ('methods' as const) : ('choices' as const));
const status = ref<CredentialVaultStatus | null>(null);
const passphrase = ref('');
const busy = ref(false);
let generation = 0;
const needsPassphrase = computed(() => status.value?.state === 'locked' && !status.value.deviceProtected);
const showPassphrase = computed(() => !status.value?.deviceProtected || status.value.state !== 'locked');
const canGoBack = computed(
  () => history.value.length > 0 && phase.value !== 'checking' && !busy.value && !importing.value
);

function goTo(next: Phase): void {
  if (next === phase.value) return;
  history.value.push(phase.value);
  phase.value = next;
}

function goBack(): void {
  if (!canGoBack.value) return;
  const previous = history.value.pop();
  if (!previous) return;
  generation++;
  passphrase.value = '';
  pendingBundles.value = [];
  fileName.value = '';
  phase.value = previous;
}

function reset(): void {
  generation++;
  passphrase.value = '';
  status.value = null;
  busy.value = false;
  pendingBundles.value = [];
  fileName.value = '';
  phase.value = 'checking';
  history.value = [];
  initialFileConsumed.value = false;
}

async function initialize(): Promise<void> {
  reset();
  if (props.showGuide) {
    phase.value = 'guide';
    return;
  }
  await checkProtection();
}

async function continueGuide(): Promise<void> {
  if (phase.value !== 'guide') return;
  history.value.push('guide');
  await checkProtection();
}

async function checkProtection(): Promise<void> {
  phase.value = 'checking';
  if (!props.vault?.prepareAuthorization) {
    phase.value = readyPhase();
    return;
  }
  const current = generation;
  try {
    const next = await props.vault.status();
    if (current !== generation || !props.open) return;
    status.value = next;
    if (next.state === 'invalid') throw new Error('INVALID_VAULT');
    phase.value = next.state === 'unlocked' ? readyPhase() : 'protection';
    if (next.state === 'unlocked') emit('prepared', next);
  } catch {
    if (current !== generation || !props.open) return;
    phase.value = 'error';
    toast.error(text('protectionFailed'));
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void initialize();
    else reset();
  },
  { immediate: true }
);
onBeforeUnmount(reset);

watch(
  [phase, () => props.initialFile],
  ([currentPhase, file]) => {
    if (currentPhase === 'methods' && file && props.open && !initialFileConsumed.value) {
      initialFileConsumed.value = true;
      goTo('file');
      void readCredentialFile(file);
    }
  },
  { immediate: true }
);

async function prepare(): Promise<void> {
  const vault = props.vault;
  if (!vault?.prepareAuthorization || busy.value || phase.value !== 'protection') return;
  // Going back reviews the completed step; it must never rotate a key or replace a passphrase.
  if (status.value?.state === 'unlocked') {
    goTo(readyPhase());
    return;
  }
  if (needsPassphrase.value && !passphrase.value) return;
  const current = generation;
  busy.value = true;
  try {
    const locked = status.value?.state === 'locked';
    if (!locked && passphrase.value) validateVaultPassphrase(passphrase.value);
    const next = locked
      ? await vault.unlock(status.value?.deviceProtected ? '' : passphrase.value)
      : await vault.prepareAuthorization(passphrase.value);
    if (current !== generation || !props.open) return;
    if (next.state !== 'unlocked') throw new Error('VAULT_NOT_UNLOCKED');
    status.value = next;
    goTo(readyPhase());
    emit('prepared', next);
  } catch {
    if (current === generation && props.open) toast.error(text('protectionFailed'));
  } finally {
    if (current === generation) {
      passphrase.value = '';
      busy.value = false;
    }
  }
}

async function readFile(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  await readCredentialFile(file);
}

async function readCredentialFile(file: File | undefined): Promise<void> {
  const current = ++generation;
  pendingBundles.value = [];
  fileName.value = '';
  if (!file) return;
  busy.value = true;
  try {
    if (file.size > 256 * 1024) throw new Error('FILE_TOO_LARGE');
    const bundles = parseAlibabaCredentialImport(JSON.parse(await file.text()) as unknown);
    if (props.protocol && bundles.some((bundle) => (bundle.protocol ?? 'top') !== props.protocol))
      throw new Error('AUTH_IMPORT_PROTOCOL_MISMATCH');
    if (bundles.length > 1 && !props.acquisition?.importBundles) throw new Error('AUTH_IMPORT_UNAVAILABLE');
    if (current !== generation || !props.open) return;
    pendingBundles.value = bundles;
    fileName.value = file.name;
  } catch (error: unknown) {
    if (current === generation && props.open)
      toast.error(
        text(
          error instanceof Error && error.message === 'AUTH_IMPORT_PROTOCOL_MISMATCH'
            ? 'profileMismatch'
            : error instanceof Error && error.message === 'AUTH_IMPORT_DUPLICATE_PROTOCOL'
              ? 'offlineDuplicate'
              : 'offlineInvalid'
        )
      );
  } finally {
    if (current === generation) busy.value = false;
  }
}

async function importFile(): Promise<void> {
  const bundles = pendingBundles.value;
  const first = bundles[0];
  const repository = props.acquisition;
  if (!first || !repository || busy.value || importing.value) return;
  importing.value = true;
  const current = generation;
  let saved = false;
  try {
    if (props.beforeImport && !(await props.beforeImport())) return;
    if (current !== generation || !props.open) return;
    let next: CredentialVaultStatus;
    if (bundles.length === 1 && repository.importBundle) next = await repository.importBundle(first);
    else if (repository.importBundles) next = await repository.importBundles(bundles);
    else throw new Error('AUTH_IMPORT_UNAVAILABLE');
    saved = true;
    pendingBundles.value = [];
    fileName.value = '';
    if (isCurrent(current)) {
      emit('imported', next);
      toast.success(text('offlineSaved'));
    }
  } catch {
    toast.error(text('offlineFailed'));
  } finally {
    importing.value = false;
    if (saved) close(false);
  }
}

function isCurrent(current: number): boolean {
  return current === generation && props.open;
}

function close(open: boolean): void {
  if (importing.value) return;
  if (!open) reset();
  emit('update:open', open);
}

function select(protocol: 'top' | 'iop'): void {
  if (phase.value !== 'choices' || (props.protocol && props.protocol !== protocol)) return;
  // Keep the selection handler on the click stack for Chrome's optional-permission prompt.
  emit('select', protocol);
  close(false);
}

function chooseOnline(): void {
  goTo('choices');
  if (props.protocol) select(props.protocol);
}
</script>

<template>
  <ModalDialog
    :open="open"
    :dismissible="!importing"
    :title="
      phase === 'guide'
        ? text('authorizationWizard')
        : text(purpose === 'renew' ? 'chooseRenewProtocol' : 'chooseAcquireProtocol')
    "
    :description="
      phase === 'guide'
        ? t('auth.onboarding.introduction.extension')
        : text(
            phase === 'choices'
              ? 'chooseProtocolDescription'
              : phase === 'methods' || phase === 'file'
                ? 'chooseMethodDescription'
                : 'protectionDescription'
          )
    "
    :size="phase === 'guide' ? 'lg' : 'sm'"
    @update:open="close"
  >
    <AlibabaAuthorizationGuide v-if="phase === 'guide'" />
    <p v-else-if="phase === 'checking'" role="status">{{ t('common.actions.loading') }}</p>
    <p v-else-if="phase === 'error'" role="alert">{{ text('protectionFailed') }}</p>
    <div
      v-else-if="phase === 'protection' && status?.state === 'unlocked'"
      class="grid gap-3"
      data-testid="authorization-protection-ready"
    >
      <p class="text-sm leading-6">{{ text('protectionReady') }}</p>
      <Button data-testid="continue-authorization-protection" @click="prepare">{{
        text('protectionContinue')
      }}</Button>
    </div>
    <form
      v-else-if="phase === 'protection'"
      class="grid gap-3"
      data-testid="authorization-protection"
      @submit.prevent="prepare"
    >
      <label v-if="showPassphrase" class="text-sm font-medium">
        {{ text(needsPassphrase ? 'protectionOriginal' : 'protectionOptional') }}
        <Input
          v-model="passphrase"
          class="mt-2"
          type="password"
          :autocomplete="needsPassphrase ? 'current-password' : 'new-password'"
          :required="needsPassphrase"
          :disabled="busy"
          :aria-label="text(needsPassphrase ? 'protectionOriginal' : 'protectionOptional')"
          :placeholder="needsPassphrase ? '' : text('protectionPlaceholder')"
          data-testid="authorization-protection-passphrase"
          data-feedback-redact
        />
      </label>
      <p class="text-xs leading-5 text-muted-foreground">
        {{ text(needsPassphrase ? 'protectionOriginalHelp' : 'protectionDeviceHelp') }}
      </p>
      <Button
        type="submit"
        :disabled="busy || (needsPassphrase && !passphrase)"
        data-testid="continue-authorization-protection"
      >
        {{ busy ? t('common.actions.processing') : text('protectionContinue') }}
      </Button>
    </form>
    <div v-else-if="phase === 'methods'" class="grid gap-3" data-testid="authorization-method-choices">
      <Button
        variant="outline"
        class="h-auto justify-start gap-3 whitespace-normal p-4 text-left"
        data-testid="authorization-method-file"
        @click="goTo('file')"
      >
        <FileUp class="size-5 shrink-0" aria-hidden="true" />
        <span
          ><span class="block font-medium">{{
            text(protocol === 'top' ? 'topImport' : 'offlineMethod')
          }}</span
          ><span class="mt-1 block text-xs text-muted-foreground">{{
            text(protocol === 'top' ? 'topImportHelp' : 'offlineMethodHelp')
          }}</span></span
        >
      </Button>
      <Button
        variant="outline"
        class="h-auto justify-start gap-3 whitespace-normal p-4 text-left"
        data-testid="authorization-method-online"
        @click="chooseOnline"
      >
        <Globe class="size-5 shrink-0" aria-hidden="true" />
        <span
          ><span class="block font-medium">{{
            text(protocol === 'top' ? 'topReauthorize' : 'onlineMethod')
          }}</span
          ><span class="mt-1 block text-xs text-muted-foreground">{{
            text(protocol === 'top' ? 'topReauthorizeHelp' : 'onlineMethodHelp')
          }}</span></span
        >
      </Button>
      <p v-if="protocol === 'top'" class="text-xs leading-5 text-muted-foreground">
        {{ text('topIopRecommendation') }}
      </p>
    </div>
    <div v-else-if="phase === 'file'" class="grid gap-3" data-testid="authorization-file-import">
      <input
        ref="fileInput"
        class="sr-only"
        type="file"
        accept="application/json,.json"
        :disabled="busy || importing"
        :aria-label="text('offlineChooseFile')"
        @change="readFile"
      />
      <Button variant="outline" :disabled="busy || importing" @click="fileInput?.click()"
        ><FileUp class="size-4" aria-hidden="true" />{{ text('offlineChooseFile') }}</Button
      >
      <div
        v-if="pendingBundles.length"
        class="grid gap-2 rounded-md border p-3 text-sm"
        data-testid="authorization-file-preview"
      >
        <div class="break-all">{{ fileName }}</div>
        <div v-for="bundle in pendingBundles" :key="bundle.protocol ?? 'top'">
          {{ (bundle.protocol ?? 'top').toUpperCase() }} · {{ bundle.application.appName }}
        </div>
      </div>
      <p class="text-xs leading-5 text-muted-foreground">{{ text('offlineReplaceHelp') }}</p>
      <Button
        :disabled="!pendingBundles.length || busy || importing"
        data-testid="confirm-authorization-file-import"
        @click="importFile"
        >{{ busy || importing ? t('common.actions.processing') : text('offlineImportSave') }}</Button
      >
    </div>
    <div
      v-else-if="phase === 'choices'"
      class="grid gap-3"
      data-testid="alibaba-authorization-protocol-choices"
    >
      <Button
        v-if="!protocol || protocol === 'iop'"
        class="h-auto justify-between gap-3 whitespace-normal p-4 text-left"
        variant="outline"
        data-testid="choose-authorization-iop"
        @click="select('iop')"
      >
        <span class="min-w-0">
          <span class="block font-medium">{{ text('chooseProtocolIop') }}</span>
          <span class="mt-1 block text-xs leading-5 text-muted-foreground">{{
            text('chooseProtocolIopHelp')
          }}</span>
        </span>
        <ArrowRight class="size-4 shrink-0" aria-hidden="true" />
      </Button>
      <Button
        v-if="!protocol || protocol === 'top'"
        class="h-auto justify-between gap-3 whitespace-normal p-4 text-left"
        variant="outline"
        data-testid="choose-authorization-top"
        @click="select('top')"
      >
        <span class="min-w-0">
          <span class="block font-medium">{{ text('chooseProtocolTop') }}</span>
          <span class="mt-1 block text-xs leading-5 text-muted-foreground">{{
            text('chooseProtocolTopHelp')
          }}</span>
        </span>
        <ArrowRight class="size-4 shrink-0" aria-hidden="true" />
      </Button>
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          v-if="history.length"
          variant="outline"
          :disabled="!canGoBack"
          data-testid="authorization-wizard-back"
          @click="goBack"
          ><ArrowLeft class="size-4" aria-hidden="true" />{{ text('wizardBack') }}</Button
        >
        <Button
          variant="outline"
          :disabled="importing"
          data-testid="cancel-authorization-protocol"
          @click="close(false)"
        >
          {{ t('common.actions.cancel') }}
        </Button>
        <Button v-if="phase === 'guide'" data-testid="authorization-wizard-continue" @click="continueGuide"
          ><ArrowRight class="size-4" aria-hidden="true" />{{ text('wizardContinue') }}</Button
        >
        <Button v-if="phase === 'error'" variant="outline" @click="checkProtection">{{
          t('common.actions.retry')
        }}</Button>
      </div>
    </template>
  </ModalDialog>
</template>
