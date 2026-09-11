<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { KeyRound, RefreshCw, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { parseAlibabaOpenApiCredentialBundle, parseManualGatewayCredential } from '@one-vegetable/core';
import type {
  AlibabaOpenApiCredentialBundle,
  ControlGatewayCredentialSummary,
  GatewayCredentialTestResult
} from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { useGatewayCredentialsI18n } from '../i18n/gateway-credentials';
import { formatDateTime } from '../lib/date-time';
import { notifyGatewayConfigurationChanged } from '../lib/gateway-configuration-events';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import AlibabaIndependentNotice from './AlibabaIndependentNotice.vue';

const { control, runtime } = useServices();
const t = useGatewayCredentialsI18n();
const summary = ref<ControlGatewayCredentialSummary | null>(null);
const latestTest = ref<GatewayCredentialTestResult | null>(null);
const admin = ref(false);
const busy = ref(false);
const error = ref<unknown>(null);
const unavailable = ref(false);
const dialog = ref(false);
const confirmation = ref<'save' | 'import' | 'clear' | null>(null);
const pendingBundle = ref<AlibabaOpenApiCredentialBundle | null>(null);
const fileName = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const fields = reactive({
  appName: '',
  appKey: '',
  appSecret: '',
  accessToken: '',
  refreshToken: '',
  expires: '',
  refreshExpires: '',
  remark: ''
});
const real = computed(() => runtime?.backendMeta?.gatewayMode === 'real');
const managed = computed(() => summary.value?.revision !== null && summary.value?.revision !== undefined);
const valid = computed(() =>
  Boolean(fields.appKey.trim() && fields.appSecret.trim() && fields.accessToken.trim())
);
const emit = defineEmits<{ changed: [] }>();
defineExpose({ reload });

onMounted(async () => {
  if (!control) return;
  busy.value = true;
  try {
    admin.value = (await control.session()).principal.role === 'admin';
    if (admin.value) await reload();
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
});
onBeforeUnmount(resetForm);
function resetForm(): void {
  Object.assign(fields, {
    appName: '',
    appKey: '',
    appSecret: '',
    accessToken: '',
    refreshToken: '',
    expires: '',
    refreshExpires: '',
    remark: ''
  });
  pendingBundle.value = null;
  fileName.value = '';
}
function closeDialog(open: boolean): void {
  if (busy.value) return;
  dialog.value = open;
  if (!open) resetForm();
}
async function reload(): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    const next = await control.gatewayCredentialStatus();
    if (summary.value && summary.value.configurationId !== next.configurationId) latestTest.value = null;
    summary.value = next;
    unavailable.value = next.managementAvailable === false;
  } catch (cause) {
    unavailable.value = true;
    error.value = cause;
  }
}
async function chooseFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = null;
  try {
    if (file.size > 1024 * 1024) throw new Error(t('invalid'));
    pendingBundle.value = parseAlibabaOpenApiCredentialBundle(JSON.parse(await file.text()) as unknown);
    fileName.value = file.name;
    confirmation.value = 'import';
  } catch {
    resetForm();
    error.value = new Error(t('invalid'));
  }
}
function dismissConfirmation(open: boolean): void {
  if (busy.value || open) return;
  if (confirmation.value === 'import') resetForm();
  confirmation.value = null;
}
async function confirm(): Promise<void> {
  if (!control || !confirmation.value) return;
  busy.value = true;
  error.value = null;
  const action = confirmation.value;
  try {
    if (action === 'clear') await control.clearGatewayCredential(summary.value?.revision ?? null);
    else if (action === 'import' && pendingBundle.value)
      await control.importGatewayCredential(pendingBundle.value, summary.value?.revision ?? null);
    else if (action === 'save') {
      if (!control.saveGatewayCredential) throw new Error(t('unavailable'));
      const credentials = parseManualGatewayCredential({
        appName: fields.appName || null,
        appKey: fields.appKey,
        appSecret: fields.appSecret,
        accessToken: fields.accessToken,
        refreshToken: fields.refreshToken || null,
        accessTokenExpiresTimeUtc: fields.expires ? Date.parse(fields.expires) : null,
        refreshTokenExpiresTimeUtc: fields.refreshExpires ? Date.parse(fields.refreshExpires) : null
      });
      await control.saveGatewayCredential(
        credentials,
        summary.value?.revision ?? null,
        fields.remark || null
      );
    }
    latestTest.value = null;
    confirmation.value = null;
    dialog.value = false;
    resetForm();
    notifyGatewayConfigurationChanged();
    emit('changed');
    toast.success(t(action === 'clear' ? 'cleared' : 'saved'));
    await reload();
  } catch (cause) {
    error.value = cause;
    confirmation.value = null;
    pendingBundle.value = null;
  } finally {
    busy.value = false;
  }
}
async function run(kind: 'test' | 'refresh' | 'reload'): Promise<void> {
  if (!control || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    if (kind === 'test' && control.testGatewayCredential) {
      latestTest.value = await control.testGatewayCredential();
      const message = t(latestTest.value.status);
      if (['passed', 'no-data'].includes(latestTest.value.status)) toast.success(message);
      else toast.error(message);
    } else if (kind === 'refresh') {
      await control.refreshGatewayCredential();
      toast.success(t('refreshed'));
    }
    await reload();
  } catch (cause) {
    error.value = cause;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Card id="alibaba-credentials" class="space-y-4 p-5" data-testid="gateway-credential-panel">
    <h2 class="flex items-center gap-2 font-semibold"><KeyRound class="size-4" />{{ t('title') }}</h2>
    <p class="text-sm text-muted-foreground">{{ t('description') }}</p>
    <p v-if="!busy && !admin" class="text-sm">{{ t('adminOnly') }}</p>
    <ErrorNotice v-if="error" :error="error" :fallback="t('error')" />
    <template v-if="admin">
      <p v-if="unavailable" class="text-sm">{{ t('unavailable') }}</p>
      <template v-else>
        <p class="text-sm font-medium">{{ summary?.configured ? t('configured') : t('empty') }}</p>
        <dl class="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground">{{ t('source') }}</dt>
            <dd>{{ summary?.source ? t(summary.source) : '—' }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('application') }}</dt>
            <dd>
              {{ summary?.appName || t('unknown') }} · {{ t('key') }} {{ summary?.appKeySuffix || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('expires') }}</dt>
            <dd>
              {{
                summary?.accessTokenExpiresTimeUtc
                  ? formatDateTime(summary.accessTokenExpiresTimeUtc)
                  : t('unknown')
              }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('refreshExpires') }}</dt>
            <dd>
              {{
                summary?.refreshTokenExpiresTimeUtc
                  ? formatDateTime(summary.refreshTokenExpiresTimeUtc)
                  : t('unknown')
              }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('refreshedAt') }}</dt>
            <dd>{{ formatDateTime(summary?.lastRefreshTimeUtc ?? null) }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('refreshError') }}</dt>
            <dd>{{ summary?.errorCode || summary?.lastRefreshErrorCode || '—' }}</dd>
          </div>
        </dl>
        <p v-if="summary?.configured && !managed" class="text-sm text-muted-foreground">{{ t('legacy') }}</p>
        <p v-if="managed && !summary?.canRefresh" class="text-sm text-muted-foreground">
          {{ t('noRefresh') }}
        </p>
        <input
          ref="fileInput"
          class="hidden"
          type="file"
          accept=".json,application/json"
          :aria-label="t('import')"
          @change="chooseFile"
        />
        <div class="flex flex-wrap gap-2">
          <Button :disabled="busy" @click="fileInput?.click()"
            ><Upload class="size-4" />{{ t('import') }}</Button
          >
          <Button
            variant="outline"
            :disabled="busy || !summary?.configured || !real"
            :title="!real ? t('notReal') : t('testNotice')"
            @click="run('test')"
            >{{ t('test') }}</Button
          >
          <Button variant="outline" :disabled="busy || !summary?.canRefresh" @click="run('refresh')">{{
            t('refresh')
          }}</Button>
          <Button variant="outline" :disabled="busy" @click="run('reload')"
            ><RefreshCw class="size-4" />{{ t('reload') }}</Button
          >
          <Button
            variant="outline"
            :disabled="busy || !summary?.configured"
            @click="confirmation = 'clear'"
            >{{ t('clear') }}</Button
          >
        </div>
        <details>
          <summary class="cursor-pointer text-sm">{{ t('advanced') }}</summary>
          <Button
            class="mt-3"
            variant="outline"
            :disabled="busy || !control?.saveGatewayCredential"
            @click="
              resetForm();
              dialog = true;
            "
            >{{ t('manual') }}</Button
          >
        </details>
        <p class="text-xs text-muted-foreground">{{ t('testNotice') }}</p>
        <div class="rounded-md bg-muted p-3 text-sm" aria-live="polite">
          <p>{{ t('lastTest') }}：{{ latestTest ? t(latestTest.status) : t('notTested') }}</p>
          <p v-if="latestTest" class="mt-1 break-all text-xs">
            {{ formatDateTime(latestTest.checkedAtUtc) }} · {{ latestTest.durationMilliseconds }} ms ·
            {{ latestTest.requestId }} <span v-if="latestTest.errorCode">· {{ latestTest.errorCode }}</span>
          </p>
        </div>
      </template>
    </template>
    <AlibabaIndependentNotice />
    <slot />
  </Card>
  <ModalDialog :open="dialog" :title="t('manual')" :description="t('required')" @update:open="closeDialog">
    <form class="space-y-3" data-feedback-redact @submit.prevent="confirmation = 'save'">
      <ErrorNotice v-if="error" :error="error" :fallback="t('error')" />
      <p class="text-sm text-muted-foreground">{{ t('required') }}</p>
      <label class="block space-y-1 text-sm"
        >AppName ({{ t('optional') }})<Input v-model="fields.appName" maxlength="256"
      /></label>
      <label
        v-for="key in ['appKey', 'appSecret', 'accessToken', 'refreshToken'] as const"
        :key="key"
        class="block space-y-1 text-sm"
        >{{ key }} <span v-if="key === 'refreshToken'">({{ t('optional') }})</span
        ><Input
          v-model="fields[key]"
          type="password"
          autocomplete="off"
          maxlength="4096"
          :required="key !== 'refreshToken'"
      /></label>
      <label class="block space-y-1 text-sm"
        >{{ t('expires') }} ({{ t('optional') }})<Input v-model="fields.expires" type="datetime-local"
      /></label>
      <label class="block space-y-1 text-sm"
        >{{ t('refreshExpires') }} ({{ t('optional') }})<Input
          v-model="fields.refreshExpires"
          type="datetime-local"
      /></label>
      <label class="block space-y-1 text-sm"
        >{{ t('remark') }}<Input v-model="fields.remark" maxlength="500"
      /></label>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" :disabled="busy" @click="closeDialog(false)">{{
          t('cancel')
        }}</Button
        ><Button type="submit" :disabled="busy || !valid">{{ t('save') }}</Button>
      </div>
    </form>
  </ModalDialog>
  <ConfirmActionDialog
    :open="confirmation !== null"
    :title="t(confirmation === 'clear' ? 'confirmClear' : 'confirmSave')"
    :description="t(confirmation === 'clear' ? 'clearBody' : 'confirmBody')"
    :destructive="confirmation === 'clear'"
    :pending="busy"
    @update:open="dismissConfirmation"
    @confirm="confirm"
  >
    <p v-if="fileName">{{ t('filePreview', { name: fileName }) }}</p>
  </ConfirmActionDialog>
</template>
