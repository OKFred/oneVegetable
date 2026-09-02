<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { Copy, RefreshCw, ShieldCheck, Trash2, UserPlus } from '@lucide/vue';
import { toast } from 'vue-sonner';

import { API_CAPABILITIES } from '@one-vegetable/core';
import type {
  ControlAuditEvent,
  ControlRequestEvent,
  ControlSystemInfo,
  ControlUser,
  ControlUserRole
} from '@one-vegetable/core';

import Card from '../components/ui/Card.vue';
import Button from '../components/ui/Button.vue';
import Input from '../components/ui/Input.vue';
import ModalDialog from '../components/ui/ModalDialog.vue';
import ConfirmActionDialog from '../components/ConfirmActionDialog.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import PageHeader from '../components/PageHeader.vue';
import SelfHostedAdminPanel from '../components/SelfHostedAdminPanel.vue';
import MetaSocialAdminPanel from '../components/MetaSocialAdminPanel.vue';
import { useUiI18n } from '../i18n';
import { formatDateTime } from '../lib/date-time';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

const { control, mode } = useServices();
const { t } = useUiI18n();
const users = ref<ControlUser[]>([]);
const usersPage = ref(1);
const usersPageSize = ref(10);
const usersTotal = ref(0);
const auditEvents = ref<ControlAuditEvent[]>([]);
const auditEventsPage = ref(1);
const auditEventsPageSize = ref(20);
const auditEventsTotal = ref(0);
const requestEvents = ref<ControlRequestEvent[]>([]);
const requestEventsPage = ref(1);
const requestEventsPageSize = ref(20);
const requestEventsTotal = ref(0);
const system = ref<ControlSystemInfo | null>(null);
const policy = ref<Record<string, unknown> | null>(null);
const error = ref<unknown>(null);
const notice = ref('');
const loading = ref(false);
const username = ref('');
const password = ref('');
const role = ref<ControlUserRole>('user');
const remark = ref('');
const requestIdFilter = ref('');
const remarkDrafts = ref<Record<string, string>>({});
type AdminActionConfirmation =
  | { kind: 'status'; user: ControlUser }
  | { kind: 'role'; user: ControlUser }
  | { kind: 'password'; user: ControlUser }
  | { kind: 'sessions'; user: ControlUser }
  | { kind: 'purge' };
const actionConfirmation = ref<AdminActionConfirmation | null>(null);
const temporaryPassword = ref<{ username: string; value: string } | null>(null);
const enrollment = ref<{
  username: string;
  token: string;
  expiresTimeUtc: number;
} | null>(null);
const selfHosted = computed(() => system.value?.environment === 'self-hosted');

const actionTitle = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return t('admin.view.confirmation.defaultTitle');
  if (action.kind === 'purge') return t('admin.view.confirmation.purgeTitle');
  if (action.kind === 'status') {
    return action.user.status === 'active'
      ? t('admin.view.confirmation.disableTitle')
      : t('admin.view.confirmation.enableTitle');
  }
  if (action.kind === 'role') {
    return action.user.role === 'admin'
      ? t('admin.view.confirmation.demoteTitle')
      : t('admin.view.confirmation.promoteTitle');
  }
  if (action.kind === 'password') return t('admin.view.confirmation.passwordTitle');
  return t('admin.view.confirmation.sessionsTitle');
});
const actionDescription = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return '';
  if (action.kind === 'purge') {
    return t('admin.view.confirmation.purgeDescription', {
      days: system.value?.requestEventRetentionDays ?? t('admin.view.confirmation.configured')
    });
  }
  if (action.kind === 'status') {
    return action.user.status === 'active'
      ? t('admin.view.confirmation.disableDescription', { username: action.user.username })
      : t('admin.view.confirmation.enableDescription', { username: action.user.username });
  }
  if (action.kind === 'role') {
    return action.user.role === 'admin'
      ? t('admin.view.confirmation.demoteDescription', { username: action.user.username })
      : t('admin.view.confirmation.promoteDescription', { username: action.user.username });
  }
  if (action.kind === 'password') {
    return t('admin.view.confirmation.passwordDescription', { username: action.user.username });
  }
  return t('admin.view.confirmation.sessionsDescription', { username: action.user.username });
});
const actionDestructive = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return false;
  if (action.kind === 'status') return action.user.status === 'active';
  return action.kind !== 'role' || action.user.role === 'admin';
});

const capabilitySummary = computed(() => ({
  total: API_CAPABILITIES.length,
  readable: API_CAPABILITIES.filter(
    (capability) => capability.enabled && capability.lifecycle === 'active' && capability.risk === 'read'
  ).length,
  mutationsLocked: API_CAPABILITIES.filter((capability) => capability.risk === 'mutation').length,
  restricted: API_CAPABILITIES.filter((capability) => capability.restricted).length
}));

onMounted(refresh);

async function refresh(): Promise<void> {
  if (!control) return;
  loading.value = true;
  error.value = null;
  try {
    const [, , , systemInfo, policyInfo] = await Promise.all([
      loadUsers(),
      loadAuditEvents(),
      loadRequestEvents(),
      control.system(),
      control.policySummary()
    ]);
    system.value = systemInfo;
    policy.value = policyInfo;
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, t('admin.view.errors.load'));
  } finally {
    loading.value = false;
  }
}

async function loadUsers(): Promise<void> {
  if (!control) return;
  const result = await control.listUsers(usersPage.value, usersPageSize.value);
  users.value = result.items;
  usersTotal.value = result.total;
  remarkDrafts.value = Object.fromEntries(result.items.map((user) => [user.id, user.remark ?? '']));
}

async function loadAuditEvents(): Promise<void> {
  if (!control) return;
  const requestFilter = requestIdFilter.value.trim();
  const result = await control.listAudit({
    page: auditEventsPage.value,
    pageSize: auditEventsPageSize.value,
    ...(requestFilter ? { requestIdFilter: requestFilter } : {})
  });
  auditEvents.value = result.items;
  auditEventsTotal.value = result.total;
}

async function loadRequestEvents(): Promise<void> {
  if (!control) return;
  const requestFilter = requestIdFilter.value.trim();
  const result = await control.listRequestEvents({
    page: requestEventsPage.value,
    pageSize: requestEventsPageSize.value,
    ...(requestFilter ? { requestIdFilter: requestFilter } : {})
  });
  requestEvents.value = result.items;
  requestEventsTotal.value = result.total;
}

async function loadSection(loader: () => Promise<void>, fallbackMessage: string): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    await loader();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, fallbackMessage);
  } finally {
    loading.value = false;
  }
}

async function setUsersPage(page: number): Promise<void> {
  usersPage.value = page;
  await loadSection(loadUsers, t('admin.view.errors.usersLoad'));
}

async function setUsersPageSize(pageSize: number): Promise<void> {
  usersPage.value = 1;
  usersPageSize.value = pageSize;
  await loadSection(loadUsers, t('admin.view.errors.usersLoad'));
}

async function setAuditEventsPage(page: number): Promise<void> {
  auditEventsPage.value = page;
  await loadSection(loadAuditEvents, t('admin.view.errors.auditLoad'));
}

async function setAuditEventsPageSize(pageSize: number): Promise<void> {
  auditEventsPage.value = 1;
  auditEventsPageSize.value = pageSize;
  await loadSection(loadAuditEvents, t('admin.view.errors.auditLoad'));
}

async function setRequestEventsPage(page: number): Promise<void> {
  requestEventsPage.value = page;
  await loadSection(loadRequestEvents, t('admin.view.errors.requestsLoad'));
}

async function setRequestEventsPageSize(pageSize: number): Promise<void> {
  requestEventsPage.value = 1;
  requestEventsPageSize.value = pageSize;
  await loadSection(loadRequestEvents, t('admin.view.errors.requestsLoad'));
}

async function applyRequestIdFilter(): Promise<void> {
  auditEventsPage.value = 1;
  requestEventsPage.value = 1;
  await loadSection(async () => {
    await Promise.all([loadAuditEvents(), loadRequestEvents()]);
  }, t('admin.view.errors.filter'));
}

async function purgeRequestEvents(): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    const result = await control.purgeRequestEvents();
    notice.value = t('admin.view.feedback.purgedNotice', {
      count: result.deletedCount,
      days: result.retentionDays
    });
    toast.success(t('admin.view.feedback.purgedToast', { count: result.deletedCount }));
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, t('admin.view.errors.purge'));
  }
}

async function createUser(): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    const createdUsername = username.value;
    if (selfHosted.value) {
      if (!control.createUserEnrollment) throw new Error(t('admin.view.errors.enrollmentUnsupported'));
      const result = await control.createUserEnrollment({
        username: username.value,
        role: role.value,
        remark: remark.value || null
      });
      enrollment.value = {
        username: result.user.username,
        token: result.enrollmentToken,
        expiresTimeUtc: result.expiresTimeUtc
      };
    } else {
      await control.createUser({
        username: username.value,
        password: password.value,
        role: role.value,
        remark: remark.value || null
      });
    }
    username.value = '';
    password.value = '';
    remark.value = '';
    toast.success(t('admin.view.feedback.userCreated', { username: createdUsername }));
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, t('admin.view.errors.createUser'));
  }
}

async function toggleStatus(user: ControlUser): Promise<void> {
  return updateUser(user, { status: user.status === 'active' ? 'disabled' : 'active' });
}

async function toggleRole(user: ControlUser): Promise<void> {
  return updateUser(user, { role: user.role === 'admin' ? 'user' : 'admin' });
}

async function saveRemark(user: ControlUser): Promise<void> {
  const remarkValue = remarkDrafts.value[user.id]?.trim() ?? '';
  return updateUser(user, { remark: remarkValue === '' ? null : remarkValue });
}

async function updateUser(
  user: ControlUser,
  patch: Partial<Pick<ControlUser, 'role' | 'status' | 'remark'>>
): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    await control.updateUser({
      userId: user.id,
      role: patch.role ?? user.role,
      status: patch.status ?? user.status,
      revision: user.revision,
      remark: patch.remark === undefined ? user.remark : patch.remark
    });
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, t('admin.view.errors.updateUser'));
  }
}

async function resetPassword(user: ControlUser): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    const result = await control.resetPassword(user.id, user.revision);
    if (result.temporaryPassword) {
      temporaryPassword.value = { username: user.username, value: result.temporaryPassword };
    } else {
      toast.success(t('admin.view.feedback.passwordReset', { username: user.username }));
    }
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, t('admin.view.errors.resetPassword'));
  }
}

async function revokeSessions(user: ControlUser): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    await control.revokeSessions(user.id);
    notice.value = t('admin.view.feedback.sessionsRevoked', { username: user.username });
    toast.success(t('admin.view.feedback.sessionsRevokedToast', { username: user.username }));
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, t('admin.view.errors.revokeSessions'));
  }
}

function requestAdminAction(action: AdminActionConfirmation): void {
  actionConfirmation.value = action;
}

function confirmAdminAction(): void {
  const action = actionConfirmation.value;
  actionConfirmation.value = null;
  if (!action) return;
  if (action.kind === 'purge') {
    void purgeRequestEvents();
    return;
  }
  if (action.kind === 'status') {
    void toggleStatus(action.user);
    return;
  }
  if (action.kind === 'role') {
    void toggleRole(action.user);
    return;
  }
  if (action.kind === 'password') {
    void resetPassword(action.user);
    return;
  }
  void revokeSessions(action.user);
}

async function copyTemporaryPassword(): Promise<void> {
  if (!temporaryPassword.value) return;
  try {
    await globalThis.navigator.clipboard.writeText(temporaryPassword.value.value);
    toast.success(t('admin.view.feedback.passwordCopied'));
  } catch {
    toast.error(t('admin.view.errors.copyPassword'));
  }
}

function enrollmentUrl(): string {
  if (!enrollment.value) return '';
  const url = new URL(globalThis.location.href);
  url.searchParams.set('enrollment', enrollment.value.token);
  url.hash = '/dashboard';
  return url.toString();
}

async function copyEnrollmentUrl(): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(enrollmentUrl());
    toast.success(t('admin.view.feedback.enrollmentCopied'));
  } catch {
    toast.error(t('admin.view.errors.copyEnrollment'));
  }
}

function closeTemporaryPassword(): void {
  temporaryPassword.value = null;
}

function userVisibleCause(cause: unknown, fallbackMessage: string): Error {
  return cause instanceof Error ? cause : new Error(fallbackMessage);
}

const userColumns = computed<DataColumn<ControlUser>[]>(() => [
  {
    accessorKey: 'username',
    header: t('admin.view.users.columns.user'),
    cell: ({ row }) =>
      h('div', { class: 'min-w-56' }, [
        h('p', { class: 'font-medium' }, row.original.username),
        h('div', { class: 'mt-1 flex gap-1' }, [
          h(Input, {
            modelValue: remarkDrafts.value[row.original.id] ?? '',
            class: 'h-8',
            placeholder: t('admin.view.users.columns.remark'),
            'onUpdate:modelValue': (value: string) => {
              remarkDrafts.value[row.original.id] = value;
            }
          }),
          h(Button, { variant: 'ghost', size: 'sm', onClick: () => saveRemark(row.original) }, () =>
            t('admin.view.users.columns.save')
          )
        ])
      ])
  },
  {
    accessorKey: 'role',
    header: t('admin.view.users.columns.role'),
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          onClick: () => {
            requestAdminAction({ kind: 'role', user: row.original });
          }
        },
        () =>
          row.original.role === 'admin' ? t('admin.view.users.adminRole') : t('admin.view.users.userRole')
      )
  },
  {
    accessorKey: 'status',
    header: t('admin.view.users.columns.status'),
    cell: ({ row }) =>
      row.original.status === 'active'
        ? t('admin.view.users.columns.active')
        : t('admin.view.users.columns.disabled')
  },
  { accessorKey: 'revision', header: 'Revision' },
  {
    id: 'actions',
    header: t('admin.view.users.columns.actions'),
    cell: ({ row }) =>
      h('div', { class: 'flex flex-wrap gap-1' }, [
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            onClick: () => {
              requestAdminAction({ kind: 'status', user: row.original });
            }
          },
          () =>
            row.original.status === 'active'
              ? t('admin.view.users.columns.disable')
              : t('admin.view.users.columns.enable')
        ),
        h(
          Button,
          {
            class: selfHosted.value ? 'hidden' : '',
            variant: 'outline',
            size: 'sm',
            onClick: () => {
              requestAdminAction({ kind: 'password', user: row.original });
            }
          },
          () => t('admin.view.users.columns.resetPassword')
        ),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            onClick: () => {
              requestAdminAction({ kind: 'sessions', user: row.original });
            }
          },
          () => t('admin.view.users.columns.revokeSessions')
        )
      ])
  }
]);

const requestEventColumns = computed<DataColumn<ControlRequestEvent>[]>(() => [
  {
    accessorKey: 'eventTimeUtc',
    header: t('admin.view.columns.time'),
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, formatDateTime(row.original.eventTimeUtc))
  },
  {
    accessorKey: 'requestId',
    header: 'requestId',
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.requestId)
  },
  {
    accessorKey: 'actorId',
    header: t('admin.view.columns.actor'),
    cell: ({ row }) => row.original.actorId ?? 'anonymous'
  },
  {
    id: 'runtimeRoute',
    header: t('admin.view.columns.runtimeRoute'),
    cell: ({ row }) => `${row.original.runtime} / ${row.original.route}`
  },
  { accessorKey: 'operation', header: 'Operation' },
  { accessorKey: 'outcome', header: t('admin.view.columns.result') },
  {
    id: 'statusDuration',
    header: t('admin.view.columns.statusDuration'),
    cell: ({ row }) => `${row.original.statusCode} / ${row.original.durationMilliseconds} ms`
  }
]);

const auditEventColumns = computed<DataColumn<ControlAuditEvent>[]>(() => [
  {
    accessorKey: 'eventTimeUtc',
    header: t('admin.view.columns.time'),
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, formatDateTime(row.original.eventTimeUtc))
  },
  {
    accessorKey: 'requestId',
    header: 'requestId',
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.requestId)
  },
  {
    accessorKey: 'actorId',
    header: t('admin.view.columns.actor'),
    cell: ({ row }) => row.original.actorId ?? 'anonymous'
  },
  { accessorKey: 'action', header: t('admin.view.columns.action') },
  { accessorKey: 'outcome', header: t('admin.view.columns.result') },
  { accessorKey: 'reasonCode', header: t('admin.view.columns.reason') }
]);
</script>

<template>
  <PageHeader
    :eyebrow="t('admin.view.eyebrow')"
    :title="t('admin.view.title')"
    :description="t('admin.view.description')"
  >
    <Button v-if="control" variant="outline" size="sm" :disabled="loading" @click="refresh">
      <RefreshCw class="size-4" />{{ t('admin.view.refresh') }}
    </Button>
  </PageHeader>

  <Card v-if="mode === 'extension'" class="border-emerald-200 bg-emerald-50 p-5">
    <div class="flex gap-3">
      <ShieldCheck class="size-5 text-emerald-700" />
      <div>
        <h2 class="font-semibold text-emerald-950">{{ t('admin.view.localAdmin.title') }}</h2>
        <p class="mt-1 text-sm text-emerald-800">
          {{ t('admin.view.localAdmin.description') }}
        </p>
      </div>
    </div>
  </Card>

  <ErrorNotice v-if="error" class="mb-4" :error="error" :fallback="t('admin.view.errors.operation')" />
  <p
    v-if="notice"
    class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
  >
    {{ notice }}
  </p>

  <template v-if="control">
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card class="p-5">
        <p class="text-xs text-muted-foreground">{{ t('admin.view.system.runtime') }}</p>
        <p class="mt-2 font-semibold">{{ system?.runtime ?? '—' }} / {{ system?.environment ?? '—' }}</p>
      </Card>
      <Card class="p-5">
        <p class="text-xs text-muted-foreground">{{ t('admin.view.system.database') }}</p>
        <p class="mt-2 font-semibold">{{ system?.database ?? '—' }} / v{{ system?.schemaVersion ?? '—' }}</p>
      </Card>
      <Card class="p-5">
        <p class="text-xs text-muted-foreground">{{ t('admin.view.system.apiPrefix') }}</p>
        <p class="mt-2 font-mono text-sm font-semibold">{{ system?.apiPrefix ?? '—' }}</p>
      </Card>
      <Card class="p-5">
        <p class="text-xs text-muted-foreground">{{ t('admin.view.system.gateway') }}</p>
        <p class="mt-2 font-semibold">{{ system?.gatewayMode ?? '—' }}</p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{
            t('admin.view.system.gatewayCredentials', {
              credential: system?.gatewayStatus.configured
                ? t('admin.view.system.complete')
                : t('admin.view.system.notConfigured'),
              read: system?.gatewayStatus.realReadEnabled
                ? t('admin.view.system.enabled')
                : t('admin.view.system.disabled')
            })
          }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{
            t('admin.view.system.galleryMutations', {
              status: system?.gatewayStatus.mutationEnabled
                ? t('admin.view.system.enabled')
                : t('admin.view.system.disabled')
            })
          }}
        </p>
        <p
          v-if="system?.gatewayStatus.endpointOrigin"
          class="mt-1 truncate font-mono text-xs text-muted-foreground"
        >
          {{ system.gatewayStatus.endpointOrigin }} · {{ system.gatewayStatus.signMethod }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('admin.view.system.retention', { days: system?.requestEventRetentionDays ?? '—' }) }}
        </p>
      </Card>
    </div>

    <SelfHostedAdminPanel v-if="selfHosted" />
    <MetaSocialAdminPanel />

    <div class="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <Card class="overflow-hidden">
        <div class="border-b p-5">
          <h2 class="font-semibold">{{ t('admin.view.users.title') }}</h2>
        </div>
        <DataTable
          :columns="userColumns"
          :data="users"
          :page="usersPage"
          :page-size="usersPageSize"
          :total-rows="usersTotal"
          :pagination-disabled="loading"
          max-height="min(60vh, 36rem)"
          min-width="760px"
          :empty-text="t('admin.view.users.empty')"
          @update:page="setUsersPage"
          @update:page-size="setUsersPageSize"
        />
      </Card>

      <Card class="p-5">
        <h2 class="flex items-center gap-2 font-semibold">
          <UserPlus class="size-4" />{{ t('admin.view.users.createTitle') }}
        </h2>
        <form class="mt-4 space-y-3" @submit.prevent="createUser">
          <label class="block space-y-1 text-sm">
            <span>{{ t('admin.view.users.username') }}</span>
            <Input v-model="username" name="username" autocomplete="username" required />
          </label>
          <label v-if="!selfHosted" class="block space-y-1 text-sm">
            <span>{{ t('admin.view.users.initialPassword') }}</span>
            <Input
              v-model="password"
              name="password"
              type="password"
              autocomplete="new-password"
              :placeholder="t('admin.view.users.passwordPlaceholder')"
              :required="!selfHosted"
            />
          </label>
          <label class="block space-y-1 text-sm">
            <span>{{ t('admin.view.users.role') }}</span>
            <select
              v-model="role"
              name="role"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm"
              required
            >
              <option value="user">{{ t('admin.view.users.userRole') }}</option>
              <option value="admin">{{ t('admin.view.users.adminRole') }}</option>
            </select>
          </label>
          <label class="block space-y-1 text-sm">
            <span>{{ t('admin.view.users.remarkOptional') }}</span>
            <Input
              v-model="remark"
              name="remark"
              maxlength="500"
              :placeholder="t('admin.view.users.remarkPlaceholder')"
            />
          </label>
          <Button class="w-full" type="submit">
            {{ selfHosted ? t('admin.view.users.createEnrollment') : t('admin.view.users.create') }}
          </Button>
        </form>
      </Card>
    </div>

    <div class="mt-5 grid gap-5 xl:grid-cols-2">
      <Card class="p-5">
        <h2 class="font-semibold">{{ t('admin.view.policy.title') }}</h2>
        <pre
          class="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-200"
          >{{ JSON.stringify(policy, null, 2) }}</pre>
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">{{ t('admin.view.policy.capabilityTitle') }}</h2>
        <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-lg bg-muted p-3">
            {{ t('admin.view.policy.total') }}
            <strong class="float-right">{{ capabilitySummary.total }}</strong>
          </div>
          <div class="rounded-lg bg-muted p-3">
            {{ t('admin.view.policy.readable') }}
            <strong class="float-right">{{ capabilitySummary.readable }}</strong>
          </div>
          <div class="rounded-lg bg-muted p-3">
            {{ t('admin.view.policy.mutationsLocked') }}
            <strong class="float-right">{{ capabilitySummary.mutationsLocked }}</strong>
          </div>
          <div class="rounded-lg bg-muted p-3">
            {{ t('admin.view.policy.restricted') }}
            <strong class="float-right">{{ capabilitySummary.restricted }}</strong>
          </div>
        </div>
        <p class="mt-3 text-xs text-muted-foreground">
          {{ t('admin.view.policy.notice') }}
        </p>
      </Card>
    </div>

    <Card class="mt-5 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div>
          <h2 class="font-semibold">{{ t('admin.view.requests.title') }}</h2>
          <p class="text-xs text-muted-foreground">
            {{ t('admin.view.requests.description') }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <form class="flex gap-2" @submit.prevent="applyRequestIdFilter">
            <Input
              v-model="requestIdFilter"
              name="requestId"
              class="w-72"
              :aria-label="t('admin.view.requests.filterAria')"
              placeholder="requestId（UUID v4）"
            />
            <Button variant="outline" type="submit">{{ t('admin.view.requests.query') }}</Button>
          </form>
          <Button
            data-testid="purge-request-events"
            variant="outline"
            @click="requestAdminAction({ kind: 'purge' })"
          >
            <Trash2 class="size-4" />{{ t('admin.view.requests.purge') }}
          </Button>
        </div>
      </div>
      <div data-testid="request-events">
        <DataTable
          :columns="requestEventColumns"
          :data="requestEvents"
          :page="requestEventsPage"
          :page-size="requestEventsPageSize"
          :total-rows="requestEventsTotal"
          :pagination-disabled="loading"
          max-height="min(60vh, 36rem)"
          min-width="980px"
          :empty-text="t('admin.view.requests.empty')"
          @update:page="setRequestEventsPage"
          @update:page-size="setRequestEventsPageSize"
        />
      </div>
    </Card>

    <Card class="mt-5 overflow-hidden">
      <div class="border-b p-5">
        <h2 class="font-semibold">{{ t('admin.view.audit.title') }}</h2>
        <p class="text-xs text-muted-foreground">
          {{ t('admin.view.audit.description') }}
        </p>
      </div>
      <DataTable
        :columns="auditEventColumns"
        :data="auditEvents"
        :page="auditEventsPage"
        :page-size="auditEventsPageSize"
        :total-rows="auditEventsTotal"
        :pagination-disabled="loading"
        max-height="min(60vh, 36rem)"
        min-width="900px"
        :empty-text="t('admin.view.audit.empty')"
        @update:page="setAuditEventsPage"
        @update:page-size="setAuditEventsPageSize"
      />
    </Card>
  </template>

  <ConfirmActionDialog
    :open="actionConfirmation !== null"
    :title="actionTitle"
    :description="actionDescription"
    :destructive="actionDestructive"
    :confirm-label="t('admin.view.confirmation.confirm')"
    @update:open="actionConfirmation = $event ? actionConfirmation : null"
    @confirm="confirmAdminAction"
  >
    <p>{{ t('admin.view.confirmation.auditNotice') }}</p>
  </ConfirmActionDialog>

  <ModalDialog
    :open="temporaryPassword !== null"
    :title="t('admin.view.temporaryPassword.title')"
    :description="
      t('admin.view.temporaryPassword.description', {
        username: temporaryPassword?.username ?? t('admin.view.temporaryPassword.userFallback')
      })
    "
    size="sm"
    @update:open="closeTemporaryPassword"
  >
    <code
      class="block select-all break-all rounded-lg border bg-muted p-4 text-sm text-foreground"
      data-feedback-redact
    >
      {{ temporaryPassword?.value }}
    </code>
    <p class="mt-3 text-sm text-amber-700 dark:text-amber-400">
      {{ t('admin.view.temporaryPassword.warning') }}
    </p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="copyTemporaryPassword">
          <Copy class="size-4" />{{ t('admin.view.temporaryPassword.copy') }}
        </Button>
        <Button @click="closeTemporaryPassword">{{ t('admin.view.temporaryPassword.close') }}</Button>
      </div>
    </template>
  </ModalDialog>

  <ModalDialog
    :open="enrollment !== null"
    :title="t('admin.view.enrollment.title')"
    :description="
      t('admin.view.enrollment.description', {
        username: enrollment?.username ?? t('admin.view.temporaryPassword.userFallback'),
        time: formatDateTime(enrollment?.expiresTimeUtc ?? 0)
      })
    "
    size="md"
    @update:open="enrollment = null"
  >
    <code
      class="block select-all break-all rounded-lg border bg-muted p-4 text-sm text-foreground"
      data-feedback-redact
    >
      {{ enrollmentUrl() }}
    </code>
    <p class="mt-3 text-sm text-amber-700 dark:text-amber-400">
      {{ t('admin.view.enrollment.warning') }}
    </p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="copyEnrollmentUrl">
          <Copy class="size-4" />{{ t('admin.view.enrollment.copy') }}
        </Button>
        <Button @click="enrollment = null">{{ t('admin.view.enrollment.close') }}</Button>
      </div>
    </template>
  </ModalDialog>
</template>
