import { createEntityAuditFields, updateEntityAuditFields } from '@one-vegetable/core';

import { hashPassword, randomToken, sha256Base64Url, validatePassword, verifyPassword } from './password';
import { EntityVersionConflictError } from '../db/repository';
import { toPublicUser } from './types';

import type { UnixEpochMilliseconds } from '@one-vegetable/core';
import type { AuthRepository } from './repository';
import type {
  AuditEventInput,
  AuthPrincipal,
  AuthSessionResult,
  AuthUser,
  PublicUser,
  StoredSession,
  UserRole,
  UserStatus
} from './types';

export const SESSION_ABSOLUTE_MILLISECONDS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_MILLISECONDS = 30 * 60 * 1000;
export const LOGIN_LOCK_MILLISECONDS = 15 * 60 * 1000;
export const MAX_LOGIN_FAILURES = 5;

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 403 | 409 | 503
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthServiceOptions {
  repository: AuthRepository;
  bootstrapToken?: string | undefined;
  clock?: () => UnixEpochMilliseconds;
  authenticationMode?: 'password' | 'passkey';
}

export interface AuthenticatedSession {
  principal: AuthPrincipal;
  user: AuthUser;
  session: StoredSession;
}

export class AuthService {
  readonly #repository: AuthRepository;
  readonly #bootstrapToken: string | undefined;
  readonly #clock: () => UnixEpochMilliseconds;
  readonly #authenticationMode: 'password' | 'passkey';

  constructor(options: AuthServiceOptions) {
    this.#repository = options.repository;
    this.#bootstrapToken = options.bootstrapToken;
    this.#clock = options.clock ?? Date.now;
    this.#authenticationMode = options.authenticationMode ?? 'password';
  }

  async bootstrapStatus(): Promise<{
    initialized: boolean;
    bootstrapTokenConfigured: boolean;
    bootstrapAvailable: boolean;
    authenticationMode: 'password' | 'passkey';
  }> {
    const initialized = (await this.#repository.countUsers()) > 0;
    const bootstrapTokenConfigured = Boolean(this.#bootstrapToken);
    return {
      initialized,
      bootstrapTokenConfigured,
      bootstrapAvailable: !initialized && bootstrapTokenConfigured,
      authenticationMode: this.#authenticationMode
    };
  }

  async bootstrap(input: {
    requestId: string;
    bootstrapToken: string;
    username: string;
    password: string;
    remark?: string | null;
  }): Promise<{ user: PublicUser; session: AuthSessionResult; sessionToken: string }> {
    this.#assertPasswordAuthenticationEnabled();
    if (!this.#bootstrapToken || !(await tokenEquals(input.bootstrapToken, this.#bootstrapToken))) {
      throw new AuthError('INVALID_BOOTSTRAP_TOKEN', '初始化令牌无效', 403);
    }
    if ((await this.#repository.countUsers()) !== 0) {
      throw new AuthError('BOOTSTRAP_ALREADY_COMPLETED', '首个管理员已经创建', 409);
    }
    const now = this.#clock();
    const digest = await hashPassword(input.password);
    const user = await this.#repository.createUser({
      id: crypto.randomUUID(),
      username: normalizeUsername(input.username),
      passwordHash: digest.hash,
      passwordSalt: digest.salt,
      passwordLoginEnabled: true,
      role: 'admin',
      status: 'active',
      audit: createEntityAuditFields('system:bootstrap', now, input.remark)
    });
    const session = await this.#newSession(user, now);
    await this.audit({
      requestId: input.requestId,
      actorId: user.id,
      action: 'auth.bootstrap',
      resourceKind: 'user',
      resourceId: user.id,
      outcome: 'success',
      reasonCode: 'BOOTSTRAP_COMPLETED',
      revisionAfter: 1
    });
    return { user: toPublicUser(user), ...session };
  }

  async login(input: {
    requestId: string;
    username: string;
    password: string;
  }): Promise<{ user: PublicUser; session: AuthSessionResult; sessionToken: string }> {
    this.#assertPasswordAuthenticationEnabled();
    const now = this.#clock();
    const user = await this.#repository.findUserByUsername(normalizeUsername(input.username));
    if (!user) {
      await this.audit({
        requestId: input.requestId,
        actorId: null,
        action: 'auth.login',
        resourceKind: 'user',
        resourceId: null,
        outcome: 'denied',
        reasonCode: 'INVALID_CREDENTIALS'
      });
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码错误', 401);
    }
    if (user.status !== 'active') throw new AuthError('USER_DISABLED', '账号已停用', 403);
    if (!user.passwordLoginEnabled) {
      throw new AuthError('PASSWORD_LOGIN_DISABLED', '此账号仅允许使用 Passkey 登录', 403);
    }
    if (user.lockedUntilUtc !== null && user.lockedUntilUtc > now) {
      throw new AuthError('LOGIN_LOCKED', '登录失败次数过多，请稍后再试', 403);
    }
    if (!(await verifyPassword(input.password, user.passwordHash, user.passwordSalt))) {
      const failures =
        (user.lockedUntilUtc !== null && user.lockedUntilUtc <= now ? 0 : user.failedLoginCount) + 1;
      await this.#repository.recordFailedLogin(
        user.id,
        failures,
        failures >= MAX_LOGIN_FAILURES ? now + LOGIN_LOCK_MILLISECONDS : null,
        now
      );
      await this.audit({
        requestId: input.requestId,
        actorId: user.id,
        action: 'auth.login',
        resourceKind: 'user',
        resourceId: user.id,
        outcome: 'denied',
        reasonCode: failures >= MAX_LOGIN_FAILURES ? 'LOGIN_LOCKED' : 'INVALID_CREDENTIALS'
      });
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码错误', 401);
    }
    await this.#repository.resetFailedLogin(user.id, now);
    const session = await this.#newSession(user, now);
    await this.audit({
      requestId: input.requestId,
      actorId: user.id,
      action: 'auth.login',
      resourceKind: 'session',
      resourceId: session.session.sessionId,
      outcome: 'success',
      reasonCode: 'LOGIN_SUCCEEDED'
    });
    return { user: toPublicUser(user), ...session };
  }

  async authenticate(sessionToken: string): Promise<AuthenticatedSession> {
    const now = this.#clock();
    const found = await this.#repository.findSessionByTokenHash(await sha256Base64Url(sessionToken));
    if (!found) throw new AuthError('SESSION_INVALID', '会话无效', 401);
    if (
      found.user.status !== 'active' ||
      found.session.absoluteExpiresTimeUtc <= now ||
      found.session.idleExpiresTimeUtc <= now
    ) {
      await this.#repository.deleteSession(found.session.id);
      throw new AuthError(
        found.user.status !== 'active' ? 'USER_DISABLED' : 'SESSION_EXPIRED',
        found.user.status !== 'active' ? '账号已停用' : '会话已过期',
        found.user.status !== 'active' ? 403 : 401
      );
    }
    const idleExpiresTimeUtc = Math.min(
      now + SESSION_IDLE_MILLISECONDS,
      found.session.absoluteExpiresTimeUtc
    );
    await this.#repository.touchSession(found.session.id, idleExpiresTimeUtc, now);
    return {
      principal: {
        actorId: found.user.id,
        username: found.user.username,
        role: found.user.role,
        source: 'bff'
      },
      user: found.user,
      session: { ...found.session, idleExpiresTimeUtc, updateTimeUtc: now }
    };
  }

  async assertCsrf(session: StoredSession, csrfToken: string | undefined): Promise<void> {
    if (!csrfToken || !(await tokenHashEquals(csrfToken, session.csrfTokenHash))) {
      throw new AuthError('CSRF_INVALID', 'CSRF 校验失败', 403);
    }
  }

  async logout(requestId: string, authenticated: AuthenticatedSession): Promise<void> {
    await this.#repository.deleteSession(authenticated.session.id);
    await this.audit({
      requestId,
      actorId: authenticated.user.id,
      action: 'auth.logout',
      resourceKind: 'session',
      resourceId: authenticated.session.id,
      outcome: 'success',
      reasonCode: 'LOGOUT_SUCCEEDED'
    });
  }

  async changePassword(input: {
    requestId: string;
    authenticated: AuthenticatedSession;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    this.#assertPasswordAuthenticationEnabled();
    validatePassword(input.newPassword);
    if (
      !(await verifyPassword(
        input.currentPassword,
        input.authenticated.user.passwordHash,
        input.authenticated.user.passwordSalt
      ))
    ) {
      throw new AuthError('CURRENT_PASSWORD_INVALID', '当前密码错误', 403);
    }
    const now = this.#clock();
    const digest = await hashPassword(input.newPassword);
    const current = input.authenticated.user;
    const audit = updateEntityAuditFields(current, current.id, now, current.remark);
    const updated = await this.#repository.updateUser({
      id: current.id,
      expectedRevision: current.revision,
      role: current.role,
      status: current.status,
      passwordHash: digest.hash,
      passwordSalt: digest.salt,
      passwordLoginEnabled: true,
      audit
    });
    if (!updated) throw new EntityVersionConflictError();
    await this.#repository.deleteSessionsForUser(current.id);
    await this.audit({
      requestId: input.requestId,
      actorId: current.id,
      action: 'auth.password.change',
      resourceKind: 'user',
      resourceId: current.id,
      outcome: 'success',
      reasonCode: 'PASSWORD_CHANGED',
      revisionBefore: current.revision,
      revisionAfter: audit.revision
    });
  }

  audit(input: AuditEventInput): Promise<unknown> {
    return this.#repository.appendAudit(input, this.#clock());
  }

  get repository(): AuthRepository {
    return this.#repository;
  }

  async createVerifiedSession(
    user: AuthUser
  ): Promise<{ user: PublicUser; session: AuthSessionResult; sessionToken: string }> {
    if (user.status !== 'active') throw new AuthError('USER_DISABLED', '账号已停用', 403);
    const session = await this.#newSession(user, this.#clock());
    return { user: toPublicUser(user), ...session };
  }

  async #newSession(
    user: AuthUser,
    now: UnixEpochMilliseconds
  ): Promise<{ session: AuthSessionResult; sessionToken: string }> {
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const session: StoredSession = {
      id: crypto.randomUUID(),
      tokenHash: await sha256Base64Url(sessionToken),
      csrfTokenHash: await sha256Base64Url(csrfToken),
      userId: user.id,
      absoluteExpiresTimeUtc: now + SESSION_ABSOLUTE_MILLISECONDS,
      idleExpiresTimeUtc: now + SESSION_IDLE_MILLISECONDS,
      createTimeUtc: now,
      updateTimeUtc: now
    };
    await this.#repository.createSession(session);
    return {
      sessionToken,
      session: {
        principal: { actorId: user.id, username: user.username, role: user.role, source: 'bff' },
        sessionId: session.id,
        csrfToken,
        absoluteExpiresTimeUtc: session.absoluteExpiresTimeUtc,
        idleExpiresTimeUtc: session.idleExpiresTimeUtc
      }
    };
  }

  #assertPasswordAuthenticationEnabled(): void {
    if (this.#authenticationMode === 'passkey') {
      throw new AuthError('PASSWORD_LOGIN_DISABLED', '自托管环境请使用 Passkey', 403);
    }
  }
}

function normalizeUsername(value: string): string {
  const username = value.trim().toLocaleLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw new AuthError('INVALID_USERNAME', '用户名需为 3–64 位字母、数字、点、下划线或横线', 400);
  }
  return username;
}

async function tokenEquals(left: string, right: string): Promise<boolean> {
  return (await sha256Base64Url(left)) === (await sha256Base64Url(right));
}

async function tokenHashEquals(token: string, expectedHash: string): Promise<boolean> {
  return (await sha256Base64Url(token)) === expectedHash;
}

export interface AdminUserUpdate {
  role: UserRole;
  status: UserStatus;
  remark: string | null;
  expectedRevision: number;
}
