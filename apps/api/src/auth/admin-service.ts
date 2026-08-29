import { createEntityAuditFields, normalizeRemark, updateEntityAuditFields } from '@one-vegetable/core';

import { hashPassword, randomToken } from './password';
import { AuthError } from './service';
import { toPublicUser } from './types';

import type { UnixEpochMilliseconds } from '@one-vegetable/core';
import type { AuditQuery, AuthRepository } from './repository';
import type { AuditEvent, AuthPrincipal, PublicUser, UserRole, UserStatus } from './types';

export class AdminService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly clock: () => UnixEpochMilliseconds = Date.now
  ) {}

  async listUsers(page = 1, pageSize = 20): Promise<{ items: PublicUser[]; total: number }> {
    assertPage(page, pageSize);
    const result = await this.repository.listUsers(page, pageSize);
    return { items: result.items.map(toPublicUser), total: result.total };
  }

  async createUser(input: {
    requestId: string;
    actor: AuthPrincipal;
    username: string;
    password: string;
    role: UserRole;
    remark?: string | null;
  }): Promise<PublicUser> {
    const username = normalizeAdminUsername(input.username);
    if (await this.repository.findUserByUsername(username)) {
      throw new AuthError('USERNAME_EXISTS', '用户名已存在', 409);
    }
    const now = this.clock();
    const digest = await hashPassword(input.password);
    const user = await this.repository.createUser({
      id: crypto.randomUUID(),
      username,
      passwordHash: digest.hash,
      passwordSalt: digest.salt,
      passwordLoginEnabled: true,
      role: input.role,
      status: 'active',
      audit: createEntityAuditFields(input.actor.actorId, now, input.remark)
    });
    await this.repository.appendAudit(
      {
        requestId: input.requestId,
        actorId: input.actor.actorId,
        action: 'admin.users.create',
        resourceKind: 'user',
        resourceId: user.id,
        outcome: 'success',
        reasonCode: 'USER_CREATED',
        revisionAfter: 1
      },
      now
    );
    return toPublicUser(user);
  }

  async updateUser(input: {
    requestId: string;
    actor: AuthPrincipal;
    userId: string;
    role: UserRole;
    status: UserStatus;
    expectedRevision: number;
    remark: string | null;
  }): Promise<PublicUser> {
    const current = await this.#requiredUser(input.userId);
    if (
      current.role === 'admin' &&
      current.status === 'active' &&
      (input.role !== 'admin' || input.status !== 'active') &&
      (await this.repository.countActiveAdmins(current.id)) === 0
    ) {
      throw new AuthError('LAST_ACTIVE_ADMIN', '不能停用或降级最后一个有效管理员', 409);
    }
    if (current.revision !== input.expectedRevision) {
      throw new AuthError('ENTITY_VERSION_CONFLICT', '用户已被其他请求更新', 409);
    }
    const audit = updateEntityAuditFields(
      current,
      input.actor.actorId,
      this.clock(),
      normalizeRemark(input.remark)
    );
    const updated = await this.repository.updateUser({
      id: current.id,
      expectedRevision: input.expectedRevision,
      role: input.role,
      status: input.status,
      passwordHash: current.passwordHash,
      passwordSalt: current.passwordSalt,
      passwordLoginEnabled: current.passwordLoginEnabled,
      audit
    });
    if (!updated) throw new AuthError('ENTITY_VERSION_CONFLICT', '用户已被其他请求更新', 409);
    if (input.status === 'disabled') await this.repository.deleteSessionsForUser(current.id);
    await this.repository.appendAudit(
      {
        requestId: input.requestId,
        actorId: input.actor.actorId,
        action: 'admin.users.update',
        resourceKind: 'user',
        resourceId: current.id,
        outcome: 'success',
        reasonCode: 'USER_UPDATED',
        revisionBefore: current.revision,
        revisionAfter: updated.revision
      },
      this.clock()
    );
    return toPublicUser(updated);
  }

  async resetPassword(input: {
    requestId: string;
    actor: AuthPrincipal;
    userId: string;
    newPassword?: string;
    expectedRevision: number;
  }): Promise<{ user: PublicUser; temporaryPassword: string | null }> {
    const current = await this.#requiredUser(input.userId);
    if (current.revision !== input.expectedRevision) {
      throw new AuthError('ENTITY_VERSION_CONFLICT', '用户已被其他请求更新', 409);
    }
    const temporaryPassword = input.newPassword ? null : `${randomToken(18)}Aa1!`;
    const digest = await hashPassword(input.newPassword ?? temporaryPassword ?? '');
    const audit = updateEntityAuditFields(current, input.actor.actorId, this.clock(), current.remark);
    const updated = await this.repository.updateUser({
      id: current.id,
      expectedRevision: current.revision,
      role: current.role,
      status: current.status,
      passwordHash: digest.hash,
      passwordSalt: digest.salt,
      passwordLoginEnabled: true,
      audit
    });
    if (!updated) throw new AuthError('ENTITY_VERSION_CONFLICT', '用户已被其他请求更新', 409);
    await this.repository.deleteSessionsForUser(current.id);
    await this.repository.appendAudit(
      {
        requestId: input.requestId,
        actorId: input.actor.actorId,
        action: 'admin.users.password.reset',
        resourceKind: 'user',
        resourceId: current.id,
        outcome: 'success',
        reasonCode: 'PASSWORD_RESET',
        revisionBefore: current.revision,
        revisionAfter: updated.revision
      },
      this.clock()
    );
    return { user: toPublicUser(updated), temporaryPassword };
  }

  async revokeSessions(requestId: string, actor: AuthPrincipal, userId: string): Promise<void> {
    await this.#requiredUser(userId);
    await this.repository.deleteSessionsForUser(userId);
    await this.repository.appendAudit(
      {
        requestId,
        actorId: actor.actorId,
        action: 'admin.users.sessions.revoke',
        resourceKind: 'user',
        resourceId: userId,
        outcome: 'success',
        reasonCode: 'SESSIONS_REVOKED'
      },
      this.clock()
    );
  }

  listAudit(query: AuditQuery): Promise<{ items: AuditEvent[]; total: number }> {
    assertPage(query.page, query.pageSize);
    return this.repository.listAudit(query);
  }

  async #requiredUser(userId: string) {
    const user = await this.repository.findUserById(userId);
    if (!user) throw new AuthError('USER_NOT_FOUND', '用户不存在', 400);
    return user;
  }
}

function assertPage(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new AuthError('INVALID_PAGINATION', '分页参数无效', 400);
  }
}

function normalizeAdminUsername(value: string): string {
  const username = value.trim().toLocaleLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw new AuthError('INVALID_USERNAME', '用户名格式无效', 400);
  }
  return username;
}
