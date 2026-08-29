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
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

const { control, mode } = useServices();
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

const actionTitle = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return '确认管理操作';
  if (action.kind === 'purge') return '确认清理请求诊断';
  if (action.kind === 'status') return action.user.status === 'active' ? '确认停用用户' : '确认启用用户';
  if (action.kind === 'role') return action.user.role === 'admin' ? '确认降级管理员' : '确认提升管理员';
  if (action.kind === 'password') return '确认重置密码';
  return '确认撤销全部会话';
});
const actionDescription = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return '';
  if (action.kind === 'purge') {
    return `将删除超过 ${system.value?.requestEventRetentionDays ?? '配置'} 天留存周期的请求诊断记录。`;
  }
  if (action.kind === 'status') {
    return action.user.status === 'active'
      ? `停用 ${action.user.username} 后，该用户现有和后续请求都会被拒绝。`
      : `启用 ${action.user.username} 后，该用户可重新登录。`;
  }
  if (action.kind === 'role') {
    return action.user.role === 'admin'
      ? `将 ${action.user.username} 降级为普通只读用户。最后一个有效管理员不能被降级。`
      : `将 ${action.user.username} 提升为管理员，可访问用户、审计和系统管理能力。`;
  }
  if (action.kind === 'password') {
    return `将重置 ${action.user.username} 的密码；生成的一次性密码只会显示一次。`;
  }
  return `将立即撤销 ${action.user.username} 的全部登录会话，该用户需要重新登录。`;
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
    error.value = userVisibleCause(cause, '管理数据加载失败');
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
  await loadSection(loadUsers, '用户数据加载失败');
}

async function setUsersPageSize(pageSize: number): Promise<void> {
  usersPage.value = 1;
  usersPageSize.value = pageSize;
  await loadSection(loadUsers, '用户数据加载失败');
}

async function setAuditEventsPage(page: number): Promise<void> {
  auditEventsPage.value = page;
  await loadSection(loadAuditEvents, '操作审计加载失败');
}

async function setAuditEventsPageSize(pageSize: number): Promise<void> {
  auditEventsPage.value = 1;
  auditEventsPageSize.value = pageSize;
  await loadSection(loadAuditEvents, '操作审计加载失败');
}

async function setRequestEventsPage(page: number): Promise<void> {
  requestEventsPage.value = page;
  await loadSection(loadRequestEvents, '请求诊断加载失败');
}

async function setRequestEventsPageSize(pageSize: number): Promise<void> {
  requestEventsPage.value = 1;
  requestEventsPageSize.value = pageSize;
  await loadSection(loadRequestEvents, '请求诊断加载失败');
}

async function applyRequestIdFilter(): Promise<void> {
  auditEventsPage.value = 1;
  requestEventsPage.value = 1;
  await loadSection(async () => {
    await Promise.all([loadAuditEvents(), loadRequestEvents()]);
  }, 'requestId 筛选失败');
}

async function purgeRequestEvents(): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    const result = await control.purgeRequestEvents();
    notice.value = `已清理 ${result.deletedCount} 条请求诊断；保留最近 ${result.retentionDays} 天。`;
    toast.success(`已清理 ${result.deletedCount} 条过期请求诊断。`);
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, '清理请求诊断失败');
  }
}

async function createUser(): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    const createdUsername = username.value;
    await control.createUser({
      username: username.value,
      password: password.value,
      role: role.value,
      remark: remark.value || null
    });
    username.value = '';
    password.value = '';
    remark.value = '';
    toast.success(`用户 ${createdUsername} 创建成功。`);
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, '创建用户失败');
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
    error.value = userVisibleCause(cause, '更新用户失败');
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
      toast.success(`${user.username} 的密码已重置。`);
    }
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, '重置密码失败');
  }
}

async function revokeSessions(user: ControlUser): Promise<void> {
  if (!control) return;
  error.value = null;
  try {
    await control.revokeSessions(user.id);
    notice.value = `${user.username} 的所有会话已撤销`;
    toast.success(`${user.username} 的全部会话已撤销。`);
    await refresh();
  } catch (cause: unknown) {
    error.value = userVisibleCause(cause, '撤销会话失败');
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
    toast.success('一次性密码已复制，请通过安全渠道转交。');
  } catch {
    toast.error('复制失败，请手工选择一次性密码。');
  }
}

function closeTemporaryPassword(): void {
  temporaryPassword.value = null;
}

function userVisibleCause(cause: unknown, fallbackMessage: string): Error {
  return cause instanceof Error ? cause : new Error(fallbackMessage);
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

const userColumns: DataColumn<ControlUser>[] = [
  {
    accessorKey: 'username',
    header: '用户',
    cell: ({ row }) =>
      h('div', { class: 'min-w-56' }, [
        h('p', { class: 'font-medium' }, row.original.username),
        h('div', { class: 'mt-1 flex gap-1' }, [
          h(Input, {
            modelValue: remarkDrafts.value[row.original.id] ?? '',
            class: 'h-8',
            placeholder: '备注',
            'onUpdate:modelValue': (value: string) => {
              remarkDrafts.value[row.original.id] = value;
            }
          }),
          h(Button, { variant: 'ghost', size: 'sm', onClick: () => saveRemark(row.original) }, () => '保存')
        ])
      ])
  },
  {
    accessorKey: 'role',
    header: '角色',
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
        () => row.original.role
      )
  },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'revision', header: 'Revision' },
  {
    id: 'actions',
    header: '操作',
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
          () => (row.original.status === 'active' ? '停用' : '启用')
        ),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            onClick: () => {
              requestAdminAction({ kind: 'password', user: row.original });
            }
          },
          () => '重置密码'
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
          () => '撤销会话'
        )
      ])
  }
];

const requestEventColumns: DataColumn<ControlRequestEvent>[] = [
  {
    accessorKey: 'eventTimeUtc',
    header: '时间',
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, formatTime(row.original.eventTimeUtc))
  },
  {
    accessorKey: 'requestId',
    header: 'requestId',
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.requestId)
  },
  { accessorKey: 'actorId', header: '主体', cell: ({ row }) => row.original.actorId ?? 'anonymous' },
  {
    id: 'runtimeRoute',
    header: '运行时 / 路由',
    cell: ({ row }) => `${row.original.runtime} / ${row.original.route}`
  },
  { accessorKey: 'operation', header: 'Operation' },
  { accessorKey: 'outcome', header: '结果' },
  {
    id: 'statusDuration',
    header: '状态 / 耗时',
    cell: ({ row }) => `${row.original.statusCode} / ${row.original.durationMilliseconds} ms`
  }
];

const auditEventColumns: DataColumn<ControlAuditEvent>[] = [
  {
    accessorKey: 'eventTimeUtc',
    header: '时间',
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, formatTime(row.original.eventTimeUtc))
  },
  {
    accessorKey: 'requestId',
    header: 'requestId',
    cell: ({ row }) => h('code', { class: 'text-xs' }, row.original.requestId)
  },
  { accessorKey: 'actorId', header: '主体', cell: ({ row }) => row.original.actorId ?? 'anonymous' },
  { accessorKey: 'action', header: '动作' },
  { accessorKey: 'outcome', header: '结果' },
  { accessorKey: 'reasonCode', header: '原因' }
];
</script>

<template>
  <PageHeader
    eyebrow="Access control"
    title="管理后台"
    description="管理本地账号、只读策略矩阵、requestId 诊断与 append-only 审计。页面隐藏不是权限边界，BFF 会重新授权。"
  >
    <Button v-if="control" variant="outline" size="sm" :disabled="loading" @click="refresh">
      <RefreshCw class="size-4" />刷新
    </Button>
  </PageHeader>

  <Card v-if="mode === 'extension'" class="border-emerald-200 bg-emerald-50 p-5">
    <div class="flex gap-3">
      <ShieldCheck class="size-5 text-emerald-700" />
      <div>
        <h2 class="font-semibold text-emerald-950">本机管理员</h2>
        <p class="mt-1 text-sm text-emerald-800">
          插件固定使用本机管理员身份；它不等于 BFF 管理员会话，因此用户管理、服务端审计和会话撤销不可用。
        </p>
      </div>
    </div>
  </Card>

  <ErrorNotice v-if="error" class="mb-4" :error="error" fallback="管理操作失败" />
  <p
    v-if="notice"
    class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
  >
    {{ notice }}
  </p>

  <template v-if="control">
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card class="p-5">
        <p class="text-xs text-muted-foreground">运行时 / 环境</p>
        <p class="mt-2 font-semibold">{{ system?.runtime ?? '—' }} / {{ system?.environment ?? '—' }}</p>
      </Card>
      <Card class="p-5">
        <p class="text-xs text-muted-foreground">数据库 / Schema</p>
        <p class="mt-2 font-semibold">{{ system?.database ?? '—' }} / v{{ system?.schemaVersion ?? '—' }}</p>
      </Card>
      <Card class="p-5">
        <p class="text-xs text-muted-foreground">API Prefix</p>
        <p class="mt-2 font-mono text-sm font-semibold">{{ system?.apiPrefix ?? '—' }}</p>
      </Card>
      <Card class="p-5">
        <p class="text-xs text-muted-foreground">Alibaba Gateway</p>
        <p class="mt-2 font-semibold">{{ system?.gatewayMode ?? '—' }}</p>
        <p class="mt-1 text-xs text-muted-foreground">
          凭据 {{ system?.gatewayStatus.configured ? '完整' : '未配置' }} · 只读真实调用
          {{ system?.gatewayStatus.realReadEnabled ? '已启用' : '关闭' }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          图库分组 / 上传 / URL 转存 {{ system?.gatewayStatus.mutationEnabled ? '已启用' : '关闭' }}
        </p>
        <p
          v-if="system?.gatewayStatus.endpointOrigin"
          class="mt-1 truncate font-mono text-xs text-muted-foreground"
        >
          {{ system.gatewayStatus.endpointOrigin }} · {{ system.gatewayStatus.signMethod }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          请求诊断保留 {{ system?.requestEventRetentionDays ?? '—' }} 天
        </p>
      </Card>
    </div>

    <div class="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <Card class="overflow-hidden">
        <div class="border-b p-5"><h2 class="font-semibold">用户管理</h2></div>
        <DataTable
          :columns="userColumns"
          :data="users"
          :page="usersPage"
          :page-size="usersPageSize"
          :total-rows="usersTotal"
          :pagination-disabled="loading"
          max-height="min(60vh, 36rem)"
          min-width="760px"
          empty-text="暂无用户"
          @update:page="setUsersPage"
          @update:page-size="setUsersPageSize"
        />
      </Card>

      <Card class="p-5">
        <h2 class="flex items-center gap-2 font-semibold"><UserPlus class="size-4" />创建用户</h2>
        <form class="mt-4 space-y-3" @submit.prevent="createUser">
          <label class="block space-y-1 text-sm">
            <span>用户名</span>
            <Input v-model="username" name="username" autocomplete="username" required />
          </label>
          <label class="block space-y-1 text-sm">
            <span>初始密码</span>
            <Input
              v-model="password"
              name="password"
              type="password"
              autocomplete="new-password"
              placeholder="至少 12 字节密码"
              required
            />
          </label>
          <label class="block space-y-1 text-sm">
            <span>角色</span>
            <select
              v-model="role"
              name="role"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm"
              required
            >
              <option value="user">普通用户（只读）</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <label class="block space-y-1 text-sm">
            <span>备注（可选）</span>
            <Input v-model="remark" name="remark" maxlength="500" placeholder="最多 500 字符" />
          </label>
          <Button class="w-full" type="submit">创建</Button>
        </form>
      </Card>
    </div>

    <div class="mt-5 grid gap-5 xl:grid-cols-2">
      <Card class="p-5">
        <h2 class="font-semibold">策略矩阵（只读）</h2>
        <pre
          class="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-200"
          >{{ JSON.stringify(policy, null, 2) }}</pre>
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">能力状态</h2>
        <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-lg bg-muted p-3">
            目录总数 <strong class="float-right">{{ capabilitySummary.total }}</strong>
          </div>
          <div class="rounded-lg bg-muted p-3">
            可读 active <strong class="float-right">{{ capabilitySummary.readable }}</strong>
          </div>
          <div class="rounded-lg bg-muted p-3">
            通用调试器写能力关闭
            <strong class="float-right">{{ capabilitySummary.mutationsLocked }}</strong>
          </div>
          <div class="rounded-lg bg-muted p-3">
            资格受限 <strong class="float-right">{{ capabilitySummary.restricted }}</strong>
          </div>
        </div>
        <p class="mt-3 text-xs text-muted-foreground">
          管理员也不能绕过 capability、资格、聚石塔限制或 mutation flag。
        </p>
      </Card>
    </div>

    <Card class="mt-5 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div>
          <h2 class="font-semibold">请求诊断</h2>
          <p class="text-xs text-muted-foreground">
            按 requestId 精确关联运行时、路由、状态码和耗时；不保存请求体、密码、Token、Cookie 或文件 Base64。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <form class="flex gap-2" @submit.prevent="applyRequestIdFilter">
            <Input
              v-model="requestIdFilter"
              name="requestId"
              class="w-72"
              aria-label="按 requestId 查询"
              placeholder="requestId（UUID v4）"
            />
            <Button variant="outline" type="submit">查询</Button>
          </form>
          <Button
            data-testid="purge-request-events"
            variant="outline"
            @click="requestAdminAction({ kind: 'purge' })"
          >
            <Trash2 class="size-4" />按留存周期清理
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
          empty-text="暂无请求诊断"
          @update:page="setRequestEventsPage"
          @update:page-size="setRequestEventsPageSize"
        />
      </div>
    </Card>

    <Card class="mt-5 overflow-hidden">
      <div class="border-b p-5">
        <h2 class="font-semibold">操作审计</h2>
        <p class="text-xs text-muted-foreground">
          记录主体、动作、结果和拒绝原因；与请求诊断共用 requestId。
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
        empty-text="暂无操作审计"
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
    confirm-label="确认继续"
    @update:open="actionConfirmation = $event ? actionConfirmation : null"
    @confirm="confirmAdminAction"
  >
    <p>操作会由 BFF 再次校验管理员权限，并记录 requestId 和操作审计。</p>
  </ConfirmActionDialog>

  <ModalDialog
    :open="temporaryPassword !== null"
    title="一次性临时密码"
    :description="`${temporaryPassword?.username ?? '用户'} 的密码已重置。关闭后本页面不会再次显示该密码。`"
    size="sm"
    @update:open="closeTemporaryPassword"
  >
    <code class="block select-all break-all rounded-lg border bg-muted p-4 text-sm text-foreground">
      {{ temporaryPassword?.value }}
    </code>
    <p class="mt-3 text-sm text-amber-700 dark:text-amber-400">
      请先复制并通过安全渠道转交；不要把密码写入备注、日志或截图。
    </p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="copyTemporaryPassword"><Copy class="size-4" />复制密码</Button>
        <Button @click="closeTemporaryPassword">我已保存，关闭</Button>
      </div>
    </template>
  </ModalDialog>
</template>
