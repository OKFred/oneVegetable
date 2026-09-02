<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { Copy, Info, KeyRound, ShieldCheck, Sprout } from '@lucide/vue';

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/browser';
import type { ControlBootstrapStatus, ControlSession } from '@one-vegetable/core';

import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';

const emit = defineEmits<{ authenticated: [session: ControlSession] }>();
const { t } = useUiI18n();
const { control } = useServices();
const mode = ref<'login' | 'bootstrap' | 'recovery' | 'enrollment'>('login');
const username = ref('');
const password = ref('');
const bootstrapToken = ref('');
const recoveryCode = ref('');
const error = ref<unknown>(null);
const submitting = ref(false);
const bootstrapStatus = ref<ControlBootstrapStatus | null>(null);
const bootstrapStatusError = ref<unknown>(null);
const checkingBootstrapStatus = ref(true);
const pendingSession = ref<ControlSession | null>(null);
const recoveryCodes = ref<string[]>([]);
const bootstrapAvailable = computed(() => bootstrapStatus.value?.bootstrapAvailable === true);
const passkeyMode = computed(() => bootstrapStatus.value?.authenticationMode === 'passkey');
const webAuthnSupported = browserSupportsWebAuthn();

onMounted(refreshBootstrapStatus);

async function refreshBootstrapStatus(): Promise<void> {
  if (!control) return;
  checkingBootstrapStatus.value = true;
  bootstrapStatusError.value = null;
  try {
    bootstrapStatus.value = await control.bootstrapStatus();
    mode.value =
      enrollmentToken() && bootstrapStatus.value.authenticationMode === 'passkey'
        ? 'enrollment'
        : bootstrapStatus.value.bootstrapAvailable
          ? 'bootstrap'
          : 'login';
  } catch (cause: unknown) {
    bootstrapStatus.value = null;
    mode.value = 'login';
    bootstrapStatusError.value = cause instanceof Error ? cause : new Error(t('auth.errors.bootstrapStatus'));
  } finally {
    checkingBootstrapStatus.value = false;
  }
}

async function submit(): Promise<void> {
  if (!control) return;
  error.value = null;
  submitting.value = true;
  try {
    if (!passkeyMode.value) {
      const session =
        mode.value === 'login'
          ? await control.login(username.value, password.value)
          : await control.bootstrap({
              bootstrapToken: bootstrapToken.value,
              username: username.value,
              password: password.value,
              remark: t('auth.audit.firstLocalAdmin')
            });
      emit('authenticated', session);
      return;
    }
    if (!webAuthnSupported) throw new Error(t('auth.errors.passkeyUnsupported'));
    const passkeyControl = requiredPasskeyControl();
    if (mode.value === 'login') {
      const ceremony = await passkeyControl.passkeyLoginOptions();
      const response = await startAuthentication({
        optionsJSON: ceremony.options as unknown as PublicKeyCredentialRequestOptionsJSON
      });
      emit('authenticated', await passkeyControl.passkeyLoginVerify(ceremony.challengeId, response));
      return;
    }
    const ceremony =
      mode.value === 'bootstrap'
        ? await passkeyControl.passkeyBootstrapOptions(bootstrapToken.value, username.value)
        : mode.value === 'recovery'
          ? await passkeyControl.passkeyRecoveryOptions(username.value, recoveryCode.value)
          : await passkeyControl.passkeyEnrollmentOptions(enrollmentToken());
    const response = await startRegistration({
      optionsJSON: ceremony.options as unknown as PublicKeyCredentialCreationOptionsJSON
    });
    const result =
      mode.value === 'bootstrap'
        ? await passkeyControl.passkeyBootstrapVerify(
            ceremony.challengeId,
            response,
            t('auth.audit.firstPasskey')
          )
        : mode.value === 'recovery'
          ? await passkeyControl.passkeyRecoveryVerify(
              ceremony.challengeId,
              response,
              t('auth.audit.recoveryDevice')
            )
          : await passkeyControl.passkeyEnrollmentVerify(
              ceremony.challengeId,
              response,
              t('auth.audit.invitedDevice')
            );
    pendingSession.value = result.session;
    recoveryCodes.value = result.recoveryCodes;
    if (mode.value === 'enrollment') clearEnrollmentToken();
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause : new Error(t('auth.errors.authenticationFailed'));
  } finally {
    submitting.value = false;
  }
}

async function copyRecoveryCodes(): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(recoveryCodes.value.join('\n'));
  } catch {
    error.value = new Error(t('auth.errors.copyRecoveryCodes'));
  }
}

function finishRecoveryCodeStep(): void {
  if (pendingSession.value) emit('authenticated', pendingSession.value);
}

function requiredPasskeyControl() {
  if (
    !control?.passkeyBootstrapOptions ||
    !control.passkeyBootstrapVerify ||
    !control.passkeyLoginOptions ||
    !control.passkeyLoginVerify ||
    !control.passkeyRecoveryOptions ||
    !control.passkeyRecoveryVerify ||
    !control.passkeyEnrollmentOptions ||
    !control.passkeyEnrollmentVerify
  ) {
    throw new Error(t('auth.errors.passkeyClientUnsupported'));
  }
  return {
    passkeyBootstrapOptions: control.passkeyBootstrapOptions.bind(control),
    passkeyBootstrapVerify: control.passkeyBootstrapVerify.bind(control),
    passkeyLoginOptions: control.passkeyLoginOptions.bind(control),
    passkeyLoginVerify: control.passkeyLoginVerify.bind(control),
    passkeyRecoveryOptions: control.passkeyRecoveryOptions.bind(control),
    passkeyRecoveryVerify: control.passkeyRecoveryVerify.bind(control),
    passkeyEnrollmentOptions: control.passkeyEnrollmentOptions.bind(control),
    passkeyEnrollmentVerify: control.passkeyEnrollmentVerify.bind(control)
  };
}

function enrollmentToken(): string {
  return new URL(globalThis.location.href).searchParams.get('enrollment')?.trim() ?? '';
}

function clearEnrollmentToken(): void {
  const url = new URL(globalThis.location.href);
  url.searchParams.delete('enrollment');
  globalThis.history.replaceState(null, '', url);
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-slate-950 p-5">
    <Card class="w-full max-w-lg border-slate-800 bg-slate-900 text-slate-100">
      <section v-if="pendingSession" class="space-y-5 p-7">
        <div class="flex items-center gap-3">
          <span class="grid size-11 place-items-center rounded-xl bg-emerald-500 text-slate-950">
            <ShieldCheck class="size-6" />
          </span>
          <div>
            <h1 class="text-lg font-semibold">{{ t('auth.recoveryCodes.title') }}</h1>
            <p class="text-xs text-slate-400">{{ t('auth.recoveryCodes.description') }}</p>
          </div>
        </div>
        <div
          class="grid grid-cols-2 gap-2 rounded-lg border border-slate-700 bg-slate-950 p-4 font-mono text-xs"
        >
          <code v-for="code in recoveryCodes" :key="code" class="select-all break-all" data-feedback-redact>{{
            code
          }}</code>
        </div>
        <p class="text-xs text-amber-300">
          {{ t('auth.recoveryCodes.warning') }}
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" @click="copyRecoveryCodes">
            <Copy class="size-4" />{{ t('auth.recoveryCodes.copy') }}
          </Button>
          <Button type="button" @click="finishRecoveryCodeStep">{{
            t('auth.recoveryCodes.continue')
          }}</Button>
        </div>
      </section>

      <form v-else class="space-y-5 p-7" @submit.prevent="submit">
        <div class="flex items-center gap-3">
          <span class="grid size-11 place-items-center rounded-xl bg-emerald-500 text-slate-950">
            <Sprout class="size-6" />
          </span>
          <div>
            <h1 class="text-lg font-semibold">{{ t('auth.title') }}</h1>
            <p class="text-xs text-slate-400">
              {{ passkeyMode ? t('auth.subtitle.passkey') : t('auth.subtitle.local') }}
            </p>
          </div>
        </div>

        <div class="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
          <div class="flex gap-2">
            <Info class="mt-0.5 size-4 shrink-0 text-emerald-400" />
            <p>
              {{ t('auth.identityNotice') }}
            </p>
          </div>
        </div>

        <div
          v-if="passkeyMode && !bootstrapAvailable"
          class="grid grid-cols-2 rounded-lg bg-slate-950 p-1 text-sm"
        >
          <button
            type="button"
            class="rounded-md px-3 py-2 transition-colors"
            :class="mode === 'login' ? 'bg-slate-800 text-white' : 'text-slate-400'"
            @click="mode = 'login'"
          >
            {{ t('auth.modes.passkeyLogin') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2 transition-colors"
            :class="mode === 'recovery' ? 'bg-slate-800 text-white' : 'text-slate-400'"
            @click="mode = 'recovery'"
          >
            {{ t('auth.modes.recovery') }}
          </button>
        </div>

        <div
          v-else-if="bootstrapAvailable && !passkeyMode"
          class="grid grid-cols-2 rounded-lg bg-slate-950 p-1 text-sm"
        >
          <button
            type="button"
            class="rounded-md px-3 py-2"
            :class="mode === 'login' ? 'bg-slate-800 text-white' : 'text-slate-400'"
            @click="mode = 'login'"
          >
            {{ t('auth.modes.login') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2"
            :class="mode === 'bootstrap' ? 'bg-slate-800 text-white' : 'text-slate-400'"
            @click="mode = 'bootstrap'"
          >
            {{ t('auth.modes.bootstrap') }}
          </button>
        </div>

        <p v-if="checkingBootstrapStatus" class="text-xs text-slate-500">
          {{ t('auth.status.checking') }}
        </p>
        <p
          v-else-if="bootstrapStatus?.initialized && mode !== 'recovery'"
          class="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400"
        >
          {{ passkeyMode ? t('auth.status.initializedPasskey') : t('auth.status.initializedLocal') }}
        </p>
        <p
          v-else-if="bootstrapStatus && !bootstrapStatus.bootstrapTokenConfigured"
          class="rounded-md border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200"
        >
          {{ t('auth.status.missingBootstrapToken') }}
        </p>
        <ErrorNotice
          v-else-if="bootstrapStatusError"
          :error="bootstrapStatusError"
          :fallback="t('auth.errors.bootstrapStatus')"
          compact
        />

        <label v-if="mode === 'bootstrap'" class="block space-y-1.5 text-sm">
          <span>{{ t('auth.fields.bootstrapToken') }}</span>
          <Input v-model="bootstrapToken" name="bootstrapToken" type="password" autocomplete="off" required />
        </label>
        <label
          v-if="(mode !== 'login' && mode !== 'enrollment') || !passkeyMode"
          class="block space-y-1.5 text-sm"
        >
          <span>{{ t('auth.fields.username') }}</span>
          <Input
            v-model="username"
            name="username"
            autocomplete="username webauthn"
            data-feedback-redact
            required
          />
        </label>
        <label v-if="mode === 'recovery'" class="block space-y-1.5 text-sm">
          <span>{{ t('auth.fields.recoveryCode') }}</span>
          <Input
            v-model="recoveryCode"
            name="recoveryCode"
            autocomplete="off"
            data-feedback-redact
            required
          />
        </label>
        <label v-if="!passkeyMode" class="block space-y-1.5 text-sm">
          <span>{{ t('auth.fields.password') }}</span>
          <Input
            v-model="password"
            name="password"
            type="password"
            :autocomplete="mode === 'bootstrap' ? 'new-password' : 'current-password'"
            required
          />
          <span class="text-xs text-slate-500">{{ t('auth.fields.passwordHint') }}</span>
        </label>
        <ErrorNotice v-if="error" :error="error" :fallback="t('auth.errors.authenticationFailed')" compact />
        <Button class="w-full" type="submit" :disabled="submitting || checkingBootstrapStatus">
          <KeyRound class="size-4" />
          {{
            submitting
              ? t('auth.submit.working')
              : passkeyMode
                ? mode === 'bootstrap'
                  ? t('auth.submit.createPasskey')
                  : mode === 'recovery'
                    ? t('auth.submit.recoverPasskey')
                    : mode === 'enrollment'
                      ? t('auth.submit.enrollPasskey')
                      : t('auth.submit.loginPasskey')
                : mode === 'login'
                  ? t('auth.submit.login')
                  : t('auth.submit.createAdmin')
          }}
        </Button>
      </form>
    </Card>
  </main>
</template>
