<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ExternalLink, Settings2, Store } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import {
  dashboardShopScope,
  DASHBOARD_SHOP_URL_STORAGE_PREFIX,
  loadDashboardShopUrl,
  normalizeAlibabaShopUrl,
  removeDashboardShopUrl,
  saveDashboardShopUrl
} from '../lib/dashboard-shop-url';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

const { gateway, mode } = useServices();
const { t } = useUiI18n();
const scope = ref<string | null>(null);
const url = ref<string | null>(null);
const draft = ref('');
const open = ref(false);
const busy = ref(false);
const error = ref('');
const draftInvalid = computed(() => draft.value.length > 0 && !normalizeAlibabaShopUrl(draft.value));
let generation = 0;
let disposed = false;

async function readScope(): Promise<string> {
  const context = await gateway.galleryTransferContext?.();
  if (!context) throw new Error('GALLERY_CONTEXT_UNAVAILABLE');
  return dashboardShopScope(mode, context);
}

async function refresh(): Promise<void> {
  const captured = ++generation;
  try {
    const current = await readScope();
    if (captured !== generation || disposed) return;
    if (scope.value !== current) {
      open.value = false;
      draft.value = '';
    }
    scope.value = current;
    url.value = loadDashboardShopUrl(globalThis.localStorage, current);
    error.value = '';
  } catch {
    if (captured !== generation || disposed) return;
    scope.value = null;
    url.value = null;
    open.value = false;
    error.value = 'shell.dashboard.shop.unavailable';
  }
}

async function edit(): Promise<void> {
  busy.value = true;
  await refresh();
  busy.value = false;
  if (!scope.value || disposed) return;
  draft.value = url.value ?? '';
  open.value = true;
}

async function persist(clear = false): Promise<void> {
  const expected = scope.value;
  if (!expected || busy.value || (!clear && !normalizeAlibabaShopUrl(draft.value))) return;
  busy.value = true;
  error.value = '';
  try {
    const current = await readScope();
    if (disposed) return;
    if (expected !== current) {
      await refresh();
      toast.error(t('shell.dashboard.shop.contextChanged'));
      return;
    }
    if (clear) {
      removeDashboardShopUrl(globalThis.localStorage, current);
      url.value = null;
    } else {
      url.value = saveDashboardShopUrl(globalThis.localStorage, current, draft.value);
    }
    open.value = false;
    draft.value = '';
    toast.success(t(clear ? 'shell.dashboard.shop.cleared' : 'shell.dashboard.shop.saved'));
  } catch {
    error.value = 'shell.dashboard.shop.saveFailed';
  } finally {
    busy.value = false;
  }
}

function changeOpen(value: boolean): void {
  if (busy.value) return;
  open.value = value;
  if (!value) draft.value = '';
}

function storageChanged(event: StorageEvent): void {
  if (event.key === null || event.key.startsWith(DASHBOARD_SHOP_URL_STORAGE_PREFIX)) void refresh();
}

function refreshOnFocus(): void {
  void refresh();
}

onMounted(() => {
  void refresh();
  globalThis.addEventListener('focus', refreshOnFocus);
  globalThis.addEventListener('storage', storageChanged);
});
onBeforeUnmount(() => {
  disposed = true;
  generation += 1;
  globalThis.removeEventListener('focus', refreshOnFocus);
  globalThis.removeEventListener('storage', storageChanged);
});
</script>

<template>
  <div class="flex max-w-full flex-wrap items-center gap-2" data-testid="dashboard-shop-link">
    <a
      v-if="url"
      :href="url"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="dashboard-shop-visit"
    >
      <Store class="size-4" />{{ t('shell.dashboard.shop.visit') }}<ExternalLink class="size-3.5" />
    </a>
    <Button variant="outline" size="sm" :disabled="busy" data-testid="dashboard-shop-edit" @click="edit">
      <Settings2 class="size-4" />{{ t(url ? 'shell.dashboard.shop.edit' : 'shell.dashboard.shop.set') }}
    </Button>
    <p v-if="error && !open" class="basis-full text-xs text-muted-foreground" role="status">{{ t(error) }}</p>
  </div>

  <ModalDialog
    :open="open"
    :title="t('shell.dashboard.shop.title')"
    :description="t('shell.dashboard.shop.description')"
    :dismissible="!busy"
    @update:open="changeOpen"
  >
    <form id="dashboard-shop-form" class="space-y-3" @submit.prevent="persist()">
      <label for="dashboard-shop-url" class="block text-sm font-medium">{{
        t('shell.dashboard.shop.url')
      }}</label>
      <Input
        id="dashboard-shop-url"
        v-model="draft"
        type="url"
        :maxlength="2048"
        :disabled="busy"
        :aria-invalid="draftInvalid"
        :aria-describedby="draftInvalid ? 'dashboard-shop-url-error' : 'dashboard-shop-url-help'"
        autocomplete="off"
        data-testid="dashboard-shop-url"
      />
      <p id="dashboard-shop-url-help" class="text-xs text-muted-foreground">
        {{ t('shell.dashboard.shop.urlHelp') }}
      </p>
      <p v-if="draftInvalid" id="dashboard-shop-url-error" class="text-sm text-destructive" role="alert">
        {{ t('shell.dashboard.shop.invalid') }}
      </p>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ t(error) }}</p>
    </form>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          v-if="url"
          variant="destructive"
          :disabled="busy"
          data-testid="dashboard-shop-clear"
          @click="persist(true)"
          >{{ t('shell.dashboard.shop.clear') }}</Button
        >
        <Button variant="outline" :disabled="busy" @click="changeOpen(false)">{{
          t('common.actions.cancel')
        }}</Button>
        <Button
          type="submit"
          form="dashboard-shop-form"
          :disabled="busy || !normalizeAlibabaShopUrl(draft)"
          data-testid="dashboard-shop-save"
          >{{ t('common.actions.save') }}</Button
        >
      </div>
    </template>
  </ModalDialog>
</template>
