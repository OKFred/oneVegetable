<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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
import PageHeader from '../components/PageHeader.vue';
import { useServices } from '../lib/services';

const { control, mode } = useServices();
const users = ref<ControlUser[]>([]);
const auditEvents = ref<ControlAuditEvent[]>([]);
const requestEvents = ref<ControlRequestEvent[]>([]);
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
    const requestFilter = requestIdFilter.value.trim();
    const [userPage, auditPage, requestEventPage, systemInfo, policyInfo] = await Promise.all([
      control.listUsers(),
      control.listAudit({
        ...(requestFilter ? { requestIdFilter: requestFilter } : {})
      }),
      control.listRequestEvents({
        ...(requestFilter ? { requestIdFilter: requestFilter } : {})
      }),
      control.system(),
      control.policySummary()
    ]);
    users.value = userPage.items;
    remarkDrafts.value = Object.fromEntries(userPage.items.map((user) => [user.id, user.remark ?? '']));
    auditEvents.value = auditPage.items;
    requestEvents.value = requestEventPage.items;
    system.value = systemInfo;
    policy.value = policyInfo;
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : '管理数据加载失败';
  } finally {
    loading.value = false;
  }
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
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="whitespace-nowrap bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th class="p-3">用户</th>
                <th class="p-3">角色</th>
                <th class="p-3">状态</th>
                <th class="p-3">Revision</th>
                <th class="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users" :key="user.id" class="border-t">
                <td class="min-w-56 p-3">
                  <p class="font-medium">{{ user.username }}</p>
                  <div class="mt-1 flex gap-1">
                    <Input
                      :model-value="remarkDrafts[user.id] ?? ''"
                      class="h-8"
                      placeholder="备注"
                      @update:model-value="remarkDrafts[user.id] = $event"
                    />
                    <Button variant="ghost" size="sm" @click="saveRemark(user)">保存</Button>
                  </div>
                </td>
                <td class="p-3">
                  <Button variant="outline" size="sm" @click="toggleRole(user)">{{ user.role }}</Button>
                </td>
                <td class="p-3">{{ user.status }}</td>
                <td class="p-3">{{ user.revision }}</td>
                <td class="p-3">
                  <div class="flex flex-wrap gap-1">
                    <Button variant="outline" size="sm" @click="toggleStatus(user)">{{
                      user.status === 'active' ? '停用' : '启用'
                    }}</Button>
                    <Button variant="outline" size="sm" @click="resetPassword(user)">重置密码</Button>
                    <Button variant="outline" size="sm" @click="revokeSessions(user)">撤销会话</Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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
          <form class="flex gap-2" @submit.prevent="refresh">
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
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="whitespace-nowrap bg-muted/60 text-muted-foreground">
            <tr>
              <th class="p-3">时间</th>
              <th class="p-3">requestId</th>
              <th class="p-3">主体</th>
              <th class="p-3">运行时 / 路由</th>
              <th class="p-3">Operation</th>
              <th class="p-3">结果</th>
              <th class="p-3">状态 / 耗时</th>
            </tr>
          </thead>
          <tbody data-testid="request-events">
            <tr v-for="event in requestEvents" :key="event.id" class="border-t">
              <td class="whitespace-nowrap p-3">{{ formatTime(event.eventTimeUtc) }}</td>
              <td class="p-3 font-mono">{{ event.requestId }}</td>
              <td class="p-3">{{ event.actorId ?? 'anonymous' }}</td>
              <td class="p-3">{{ event.runtime }} / {{ event.route }}</td>
              <td class="p-3">{{ event.operation }}</td>
              <td class="p-3">{{ event.outcome }}</td>
              <td class="p-3">{{ event.statusCode }} / {{ event.durationMilliseconds }} ms</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <Card class="mt-5 overflow-hidden">
      <div class="border-b p-5">
        <h2 class="font-semibold">操作审计</h2>
        <p class="text-xs text-muted-foreground">
          记录主体、动作、结果和拒绝原因；与请求诊断共用 requestId。
        </p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="whitespace-nowrap bg-muted/60 text-muted-foreground">
            <tr>
              <th class="p-3">时间</th>
              <th class="p-3">requestId</th>
              <th class="p-3">主体</th>
              <th class="p-3">动作</th>
              <th class="p-3">结果</th>
              <th class="p-3">原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in auditEvents" :key="event.id" class="border-t">
              <td class="whitespace-nowrap p-3">{{ formatTime(event.eventTimeUtc) }}</td>
              <td class="p-3 font-mono">{{ event.requestId }}</td>
              <td class="p-3">{{ event.actorId ?? 'anonymous' }}</td>
              <td class="p-3">{{ event.action }}</td>
              <td class="p-3">{{ event.outcome }}</td>
              <td class="p-3">{{ event.reasonCode }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </template>
</template>
