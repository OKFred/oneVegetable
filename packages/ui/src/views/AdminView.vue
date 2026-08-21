<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { RefreshCw, ShieldCheck, Trash2, UserPlus } from '@lucide/vue';

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
import DataTable from '../components/DataTable.vue';
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
const error = ref('');
const notice = ref('');
const loading = ref(false);
const username = ref('');
const password = ref('');
const role = ref<ControlUserRole>('user');
const remark = ref('');
const requestIdFilter = ref('');
const purgeArmed = ref(false);
const remarkDrafts = ref<Record<string, string>>({});

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
  error.value = '';
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
    error.value = cause instanceof Error ? cause.message : '管理数据加载失败';
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
  error.value = '';
  try {
    await loader();
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : fallbackMessage;
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
  if (!purgeArmed.value) {
    purgeArmed.value = true;
    notice.value = '再次点击“确认清理”后，才会删除超过留存周期的请求诊断记录。';
    return;
  }
  error.value = '';
  try {
    const result = await control.purgeRequestEvents();
    purgeArmed.value = false;
    notice.value = `已清理 ${result.deletedCount} 条请求诊断；保留最近 ${result.retentionDays} 天。`;
    await refresh();
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : '清理请求诊断失败';
  }
}

async function createUser(): Promise<void> {
  if (!control) return;
  error.value = '';
  try {
    await control.createUser({
      username: username.value,
      password: password.value,
      role: role.value,
      remark: remark.value || null
    });
    username.value = '';
    password.value = '';
    remark.value = '';
    await refresh();
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : '创建用户失败';
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
  error.value = '';
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
    error.value = cause instanceof Error ? cause.message : '更新用户失败';
  }
}

async function resetPassword(user: ControlUser): Promise<void> {
  if (!control) return;
  error.value = '';
  try {
    const result = await control.resetPassword(user.id, user.revision);
    notice.value = result.temporaryPassword
      ? `${user.username} 的一次性临时密码：${result.temporaryPassword}（仅显示本次，请安全转交）`
      : `${user.username} 的密码已重置`;
    await refresh();
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : '重置密码失败';
  }
}

async function revokeSessions(user: ControlUser): Promise<void> {
  if (!control) return;
  error.value = '';
  try {
    await control.revokeSessions(user.id);
    notice.value = `${user.username} 的所有会话已撤销`;
    await refresh();
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : '撤销会话失败';
  }
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
        { variant: 'outline', size: 'sm', onClick: () => toggleRole(row.original) },
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
        h(Button, { variant: 'outline', size: 'sm', onClick: () => toggleStatus(row.original) }, () =>
          row.original.status === 'active' ? '停用' : '启用'
        ),
        h(
          Button,
          { variant: 'outline', size: 'sm', onClick: () => resetPassword(row.original) },
          () => '重置密码'
        ),
        h(
          Button,
          { variant: 'outline', size: 'sm', onClick: () => revokeSessions(row.original) },
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

  <p v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
    {{ error }}
  </p>
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
          <Input v-model="username" placeholder="用户名" />
          <Input v-model="password" type="password" placeholder="至少 12 字节密码" />
          <select v-model="role" class="h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="user">普通用户（只读）</option>
            <option value="admin">管理员</option>
          </select>
          <Input v-model="remark" placeholder="备注（可选，最多 500 字符）" />
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
            <Input v-model="requestIdFilter" class="w-72" placeholder="requestId（UUID v4）" />
            <Button variant="outline" type="submit">查询</Button>
          </form>
          <Button
            data-testid="purge-request-events"
            :variant="purgeArmed ? 'destructive' : 'outline'"
            @click="purgeRequestEvents"
          >
            <Trash2 class="size-4" />{{ purgeArmed ? '确认清理' : '按留存周期清理' }}
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
</template>
