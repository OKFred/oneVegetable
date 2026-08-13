import type { EntityAuditFields, UnixEpochMilliseconds } from '@one-vegetable/core';

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';

export interface AuthUser extends EntityAuditFields {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  status: UserStatus;
  failedLoginCount: number;
  lockedUntilUtc: UnixEpochMilliseconds | null;
}

export interface PublicUser extends EntityAuditFields {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  lockedUntilUtc: UnixEpochMilliseconds | null;
}

export interface StoredSession {
  id: string;
  tokenHash: string;
  csrfTokenHash: string;
  userId: string;
  absoluteExpiresTimeUtc: UnixEpochMilliseconds;
  idleExpiresTimeUtc: UnixEpochMilliseconds;
  createTimeUtc: UnixEpochMilliseconds;
  updateTimeUtc: UnixEpochMilliseconds;
}

export interface AuthPrincipal {
  actorId: string;
  username: string;
  role: UserRole;
  source: 'bff' | 'extension';
}

export interface AuthSessionResult {
  principal: AuthPrincipal;
  sessionId: string;
  csrfToken: string;
  absoluteExpiresTimeUtc: UnixEpochMilliseconds;
  idleExpiresTimeUtc: UnixEpochMilliseconds;
}

export interface AuditEventInput {
  requestId: string;
  actorId: string | null;
  action: string;
  resourceKind: string;
  resourceId: string | null;
  outcome: 'success' | 'error' | 'denied';
  reasonCode: string;
  revisionBefore?: number | null;
  revisionAfter?: number | null;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  eventTimeUtc: UnixEpochMilliseconds;
  revisionBefore: number | null;
  revisionAfter: number | null;
}

export function toPublicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    lockedUntilUtc: user.lockedUntilUtc,
    createTimeUtc: user.createTimeUtc,
    updateTimeUtc: user.updateTimeUtc,
    creatorId: user.creatorId,
    updaterId: user.updaterId,
    revision: user.revision,
    remark: user.remark
  };
}
