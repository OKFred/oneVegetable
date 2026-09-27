<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { AlertTriangle, Database, Download, Globe2, RefreshCw, ShieldCheck, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import type { DiagnosticsSnapshot, LocalDataCategory, LocalDataInventory } from '@one-vegetable/core';
import ActionTooltip from './ActionTooltip.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import DataTable from './DataTable.vue';
import ListActionButton from './ListActionButton.vue';
import ErrorNotice from './ErrorNotice.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Input from './ui/Input.vue';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import { useGalleryTransfers } from '../lib/gallery-transfer-service';
import type { DataColumn } from '../lib/table';

const { gateway, permissions, localData, mode } = useServices();
const galleryTransfers = useGalleryTransfers();
const { t } = useUiI18n();
const feedback = ref('');
const diagnostics = ref<DiagnosticsSnapshot | null>(null);
const diagnosticsBusy = ref(false);
const diagnosticsError = ref<unknown>(null);
const grantedHosts = ref<string[]>([]);
const permissionsBusy = ref(false);
const permissionsError = ref<unknown>(null);
const dataInventory = ref<LocalDataInventory | null>(null);
const dataBusy = ref(false);
const dataError = ref<unknown>(null);
const clearConfirmation = ref('');

const settingsConfirmation = ref<
  { kind: 'revoke-permission'; origin: string } | { kind: 'clear-diagnostics' } | null
>(null);
const settingsConfirmationTitle = computed(() =>
  settingsConfirmation.value?.kind === 'revoke-permission'
    ? t('settings.confirmation.revokeTitle')
    : t('settings.confirmation.clearDiagnosticsTitle')
);
const settingsConfirmationDescription = computed(() => {
  const confirmation = settingsConfirmation.value;
  if (!confirmation) return '';
  return confirmation.kind === 'revoke-permission'
    ? t('settings.confirmation.revokeDescription', { origin: confirmation.origin })
    : t('settings.confirmation.clearDiagnosticsDescription', {
        count: diagnostics.value?.entries.length ?? 0
      });
});
const clearDiagnosticsDisabledReason = computed(() => {
  if (diagnosticsBusy.value) return t('settings.diagnostics.busy');
  if ((diagnostics.value?.entries.length ?? 0) === 0) return t('settings.diagnostics.emptyDisabled');
  return '';
});

const lastDiagnosticError = computed(() =>
  diagnostics.value?.entries.findLast((entry) => entry.outcome === 'error')
);

const clearPhrase = computed(() => t('settings.localData.clearPhrase'));

const localDataColumns = computed<DataColumn<LocalDataCategory>[]>(() => [
  {
    accessorKey: 'label',
    header: t('settings.localData.columns.category'),
    cell: ({ row }) =>
      h('span', [
        row.original.label,
        row.original.sensitive
          ? h(
              'span',
              { class: 'ml-1 text-xs text-amber-700 dark:text-amber-400' },
              t('settings.localData.sensitive')
            )
          : null
      ])
  },
  {
    accessorKey: 'storage',
    header: t('settings.localData.columns.storage'),
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.storage)
  },
  { accessorKey: 'itemCount', header: t('settings.localData.columns.count') },
  {
    accessorKey: 'approximateBytes',
    header: t('settings.localData.columns.size'),
    cell: ({ row }) => formatBytes(row.original.approximateBytes)
  },
  {
    accessorKey: 'retention',
    header: t('settings.localData.columns.retention'),
    cell: ({ row }) => h('span', { class: 'text-xs text-muted-foreground' }, row.original.retention)
  }
]);

onMounted(async () => {
  await Promise.all([refreshDiagnostics(), refreshPermissions(), refreshLocalData()]);
});

async function refreshPermissions(): Promise<void> {
  if (!permissions) return;
  permissionsBusy.value = true;
  permissionsError.value = null;
  try {
    grantedHosts.value = await permissions.list();
  } catch (error: unknown) {
    permissionsError.value = userVisibleCause(error, t('settings.permissions.loadError'));
  } finally {
    permissionsBusy.value = false;
  }
}

async function revokePermission(origin: string): Promise<void> {
  if (!permissions) return;
  permissionsBusy.value = true;
  permissionsError.value = null;
  try {
    const removed = await permissions.revoke(origin);
    await refreshPermissions();
    feedback.value = removed
      ? t('settings.permissions.revoked', { origin })
      : t('settings.permissions.notGranted', { origin });
  } catch (error: unknown) {
    permissionsError.value = userVisibleCause(error, t('settings.permissions.revokeError'));
  } finally {
    permissionsBusy.value = false;
  }
}

async function refreshDiagnostics(): Promise<void> {
  diagnosticsBusy.value = true;
  diagnosticsError.value = null;
  diagnostics.value = null;
  try {
    diagnostics.value = await gateway.request('getDiagnostics', undefined);
  } catch (error: unknown) {
    diagnosticsError.value = userVisibleCause(error, t('settings.diagnostics.loadError'));
  } finally {
    diagnosticsBusy.value = false;
  }
}

async function exportDiagnostics(): Promise<void> {
  await refreshDiagnostics();
  if (!diagnostics.value) return;
  const blob = new Blob([JSON.stringify(diagnostics.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = `one-vegetable-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  feedback.value = t('settings.diagnostics.exported', { count: diagnostics.value.entries.length });
}

async function clearDiagnostics(): Promise<void> {
  diagnosticsBusy.value = true;
  diagnosticsError.value = null;
  try {
    await gateway.request('clearDiagnostics', undefined);
    diagnostics.value = await gateway.request('getDiagnostics', undefined);
    feedback.value = t('settings.diagnostics.cleared');
  } catch (error: unknown) {
    diagnosticsError.value = userVisibleCause(error, t('settings.diagnostics.clearError'));
  } finally {
    diagnosticsBusy.value = false;
  }
}

function confirmSettingsAction(): void {
  const confirmation = settingsConfirmation.value;
  settingsConfirmation.value = null;
  if (!confirmation) return;
  if (confirmation.kind === 'revoke-permission') {
    void revokePermission(confirmation.origin);
    return;
  }
  void clearDiagnostics();
}

async function refreshLocalData(): Promise<void> {
  if (!localData) return;
  dataBusy.value = true;
  dataError.value = null;
  dataInventory.value = null;
  try {
    dataInventory.value = await localData.inspect();
    if (galleryTransfers) {
      await galleryTransfers.reload();
      const tasks = galleryTransfers.tasks.value;
      const size = new TextEncoder().encode(JSON.stringify(tasks)).length;
      dataInventory.value.categories.push({
        id: 'gallery-transfer-tasks',
        label: t('photos.tasks.title'),
        storage: 'IndexedDB',
        itemCount: tasks.length,
        approximateBytes: size,
        sensitive: false,
        retention: t('photos.tasks.retention')
      });
      dataInventory.value.totalApproximateBytes += size;
    }
  } catch (error: unknown) {
    dataError.value = userVisibleCause(error, t('settings.localData.loadError'));
  } finally {
    dataBusy.value = false;
  }
}

async function exportLocalDataInventory(): Promise<void> {
  await refreshLocalData();
  if (!dataInventory.value) return;
  downloadJson(
    dataInventory.value,
    `one-vegetable-local-data-inventory-${new Date().toISOString().slice(0, 10)}.json`
  );
  feedback.value = t('settings.localData.exported');
}

async function clearAllLocalData(): Promise<void> {
  if (!localData || clearConfirmation.value !== clearPhrase.value) return;
  dataBusy.value = true;
  dataError.value = null;
  try {
    await galleryTransfers?.stopAndClear();
    const { clearShowcaseLocalData } = await import('../lib/showcase-storage');
    const { clearVideoAssociationLocalData } = await import('../lib/video-association-storage');
    await clearVideoAssociationLocalData(() => clearShowcaseLocalData(() => localData.clearAll()));
    const { clearColumnPreferences } = await import('../lib/column-preferences');
    clearColumnPreferences();
    const { clearAllDashboardShopUrls } = await import('../lib/dashboard-shop-url');
    clearAllDashboardShopUrls(globalThis.localStorage);
    clearConfirmation.value = '';
    // Clearing credentials remounts the workspace; keep the acknowledgement outside this panel.
    toast.success(t('settings.localData.cleared'));
    await Promise.all([refreshLocalData(), refreshDiagnostics(), refreshPermissions()]);
    feedback.value = t('settings.localData.cleared');
  } catch (error: unknown) {
    dataError.value = userVisibleCause(error, t('settings.localData.clearError'));
  } finally {
    dataBusy.value = false;
  }
}

function userVisibleCause(cause: unknown, fallbackMessage: string): Error {
  return cause instanceof Error ? cause : new Error(fallbackMessage);
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
</script>
<template>
  <div class="space-y-4">
    <p v-if="feedback" role="status" class="rounded-lg border bg-muted p-3 text-sm">{{ feedback }}</p>
    <section id="logs-local" class="min-w-0 space-y-4" :aria-label="t('settings.sections.maintenance')">
      <Card v-if="mode === 'extension' && permissions" class="p-5">
        <div class="flex items-center gap-2">
          <Globe2 class="size-4 text-primary" />
          <h2 class="font-semibold">{{ t('settings.permissions.title') }}</h2>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ t('settings.permissions.description') }}
        </p>
        <ErrorNotice v-if="permissionsError" class="mt-3" :error="permissionsError" compact />
        <p v-else-if="grantedHosts.length === 0" class="mt-3 text-sm text-muted-foreground">
          {{ t('settings.permissions.empty') }}
        </p>
        <ul v-else class="mt-3 grid gap-2">
          <li
            v-for="origin in grantedHosts"
            :key="origin"
            class="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
          >
            <code class="break-all text-xs">{{ origin }}</code>
            <Button
              size="sm"
              variant="outline"
              :aria-label="t('settings.permissions.revokeLabel', { origin })"
              :disabled="permissionsBusy"
              @click="settingsConfirmation = { kind: 'revoke-permission', origin }"
            >
              <Trash2 class="size-3.5" />{{ t('settings.permissions.revoke') }}
            </Button>
          </li>
        </ul>
        <ListActionButton
          class="mt-3"
          :icon="RefreshCw"
          :disabled="permissionsBusy"
          @click="refreshPermissions"
        >
          {{ t('settings.permissions.refresh') }}
        </ListActionButton>
      </Card>
      <Card class="p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <ShieldCheck class="size-4 text-primary" />
              <h2 class="font-semibold">{{ t('settings.diagnostics.title') }}</h2>
            </div>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ t('settings.diagnostics.description') }}
            </p>
          </div>
          <span
            :aria-label="t('settings.diagnostics.countLabel')"
            class="rounded-full bg-muted px-3 py-1 text-xs"
          >
            {{ t('settings.diagnostics.count', { count: diagnostics?.entries.length ?? 0 }) }}
          </span>
        </div>
        <div
          v-if="lastDiagnosticError"
          class="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {{ t('settings.diagnostics.latestError') }} {{ lastDiagnosticError.errorCode }} ·
          {{ lastDiagnosticError.operation }} ·
          {{ lastDiagnosticError.errorMessage }}
          <span class="mt-1 block break-all font-mono text-[11px]">
            requestId：{{ lastDiagnosticError.requestId }}
          </span>
        </div>
        <ErrorNotice v-if="diagnosticsError" class="mt-3" :error="diagnosticsError" compact />
        <div class="mt-4 flex flex-wrap gap-2">
          <ListActionButton :icon="RefreshCw" :disabled="diagnosticsBusy" @click="refreshDiagnostics">
            {{ t('settings.diagnostics.refresh') }}
          </ListActionButton>
          <ListActionButton :icon="Download" :disabled="diagnosticsBusy" @click="exportDiagnostics">
            {{ t('settings.diagnostics.export') }}
          </ListActionButton>
          <ActionTooltip
            :disabled="Boolean(clearDiagnosticsDisabledReason)"
            :reason="clearDiagnosticsDisabledReason"
          >
            <ListActionButton
              :icon="Trash2"
              :disabled="Boolean(clearDiagnosticsDisabledReason)"
              @click="settingsConfirmation = { kind: 'clear-diagnostics' }"
            >
              {{ t('settings.diagnostics.clear') }}
            </ListActionButton>
          </ActionTooltip>
        </div>
      </Card>
      <Card v-if="mode === 'extension' && localData" class="p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <Database class="size-4 text-primary" />
              <h2 class="font-semibold">{{ t('settings.localData.title') }}</h2>
            </div>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ t('settings.localData.description') }}
            </p>
          </div>
          <span class="rounded-full bg-muted px-3 py-1 text-xs">
            {{ formatBytes(dataInventory?.totalApproximateBytes ?? 0) }}
          </span>
        </div>
        <ErrorNotice v-if="dataError" class="mt-3" :error="dataError" compact />
        <DataTable
          column-settings-key="settings-local-data"
          class="mt-4"
          :columns="localDataColumns"
          :data="dataInventory?.categories ?? []"
          max-height="min(60vh, 36rem)"
          min-width="620px"
          :empty-text="t('settings.localData.empty')"
        />
        <div class="mt-4 flex flex-wrap gap-2">
          <ListActionButton :icon="RefreshCw" :disabled="dataBusy" @click="refreshLocalData">
            {{ t('settings.localData.refresh') }}
          </ListActionButton>
          <ListActionButton :icon="Download" :disabled="dataBusy" @click="exportLocalDataInventory">
            {{ t('settings.localData.export') }}
          </ListActionButton>
        </div>
        <div
          class="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"
        >
          <div class="flex items-start gap-2 text-red-900 dark:text-red-200">
            <AlertTriangle class="mt-0.5 size-4 shrink-0" />
            <div>
              <p class="text-sm font-medium">{{ t('settings.localData.dangerTitle') }}</p>
              <p class="mt-1 text-xs leading-5">
                {{ t('settings.localData.dangerDescription', { phrase: clearPhrase }) }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <Input
              v-model="clearConfirmation"
              class="max-w-xs bg-background"
              :aria-label="t('settings.localData.clearLabel')"
              autocomplete="off"
              :placeholder="clearPhrase"
            />
            <Button
              variant="outline"
              class="border-red-300 text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950"
              :disabled="dataBusy || clearConfirmation !== clearPhrase"
              @click="clearAllLocalData"
            >
              <Trash2 class="size-4" />{{ t('settings.localData.clear') }}
            </Button>
          </div>
        </div>
      </Card>
    </section>
  </div>
  <ConfirmActionDialog
    :open="settingsConfirmation !== null"
    :title="settingsConfirmationTitle"
    :description="settingsConfirmationDescription"
    destructive
    :confirm-label="t('settings.confirmation.continue')"
    @update:open="settingsConfirmation = $event ? settingsConfirmation : null"
    @confirm="confirmSettingsAction"
  >
    <p v-if="settingsConfirmation?.kind === 'clear-diagnostics'">
      {{ t('settings.confirmation.clearDiagnosticsDetail') }}
    </p>
    <p v-else>{{ t('settings.confirmation.revokeDetail') }}</p>
  </ConfirmActionDialog>
</template>
