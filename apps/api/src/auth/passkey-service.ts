import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';

import { createEntityAuditFields } from '@one-vegetable/core';
import { randomToken, sha256Base64Url } from './password';
import { AuthError } from './service';
import { toPublicUser } from './types';

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON
} from '@simplewebauthn/server';
import type { AuthRepository } from './repository';
import type { AuthService } from './service';
import type { AuthPrincipal, AuthSessionResult, AuthUser, PublicUser, UserRole } from './types';
import type {
  PasskeyChallengeKind,
  PasskeyRepository,
  StoredPasskeyChallenge,
  StoredPasskeyCredential
} from './passkey-repository';

const CHALLENGE_LIFETIME_MILLISECONDS = 5 * 60 * 1000;
const ENROLLMENT_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

export interface PasskeyCeremonyContext {
  origin: string;
  rpId: string;
}

export interface PasskeyCredentialSummary {
  id: string;
  name: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  rpId: string;
  createTimeUtc: number;
}

export interface PasskeySessionResult {
  user: PublicUser;
  session: AuthSessionResult;
  sessionToken: string;
  recoveryCodes?: string[];
}

export class PasskeyService {
  constructor(
    private readonly repository: PasskeyRepository,
    private readonly authRepository: AuthRepository,
    private readonly authService: AuthService,
    private readonly bootstrapToken: string | undefined,
    private readonly clock: () => number = Date.now
  ) {}

  async bootstrapOptions(input: {
    bootstrapToken: string;
    username: string;
    ceremony: PasskeyCeremonyContext;
  }): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    await this.#assertBootstrap(input.bootstrapToken);
    const username = normalizeUsername(input.username);
    const userId = crypto.randomUUID();
    const options = await generateRegistrationOptions({
      rpName: 'oneVegetable',
      rpID: input.ceremony.rpId,
      userName: username,
      userDisplayName: username,
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required'
      }
    });
    const challengeId = await this.#storeChallenge('bootstrap', options.challenge, input.ceremony, {
      userId,
      username
    });
    return { challengeId, options };
  }

  async bootstrapVerify(input: {
    requestId: string;
    challengeId: string;
    response: unknown;
    credentialName?: string;
  }): Promise<PasskeySessionResult> {
    const challenge = await this.#takeChallenge(input.challengeId, 'bootstrap');
    if ((await this.authRepository.countUsers()) !== 0) {
      throw new AuthError('BOOTSTRAP_ALREADY_COMPLETED', '首个管理员已经创建', 409);
    }
    const username = readContextString(challenge, 'username');
    const userId = readContextString(challenge, 'userId');
    const verified = await verifyRegistration(challenge, input.response);
    const now = this.clock();
    const user = await this.authRepository.createUser({
      id: userId,
      username,
      passwordHash: 'passkey-only',
      passwordSalt: randomToken(16),
      passwordLoginEnabled: false,
      role: 'admin',
      status: 'active',
      audit: createEntityAuditFields('system:bootstrap', now, 'Passkey 首个管理员')
    });
    await this.#saveCredential(user, verified, challenge.rpId, input.credentialName, 'system:bootstrap');
    const recoveryCodes = await this.#replaceRecoveryCodes(user.id);
    const session = await this.authService.createVerifiedSession(user);
    await this.authService.audit({
      requestId: input.requestId,
      actorId: user.id,
      action: 'auth.passkey.bootstrap',
      resourceKind: 'user',
      resourceId: user.id,
      outcome: 'success',
      reasonCode: 'PASSKEY_BOOTSTRAP_COMPLETED',
      revisionAfter: 1
    });
    return { ...session, recoveryCodes };
  }

  async loginOptions(
    ceremony: PasskeyCeremonyContext
  ): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    const options = await generateAuthenticationOptions({
      rpID: ceremony.rpId,
      userVerification: 'required'
    });
    const challengeId = await this.#storeChallenge('login', options.challenge, ceremony, {});
    return { challengeId, options };
  }

  async loginVerify(input: {
    requestId: string;
    challengeId: string;
    response: unknown;
  }): Promise<PasskeySessionResult> {
    const challenge = await this.#takeChallenge(input.challengeId, 'login');
    const response = readAuthenticationResponse(input.response);
    const credential = await this.repository.findCredential(response.id);
    if (credential?.rpId !== challenge.rpId) {
      throw new AuthError('PASSKEY_NOT_FOUND', 'Passkey 无效或不属于当前域名', 401);
    }
    const user = await this.#requiredActiveUser(credential.userId);
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpId,
        credential: toWebAuthnCredential(credential),
        requireUserVerification: true
      });
    } catch {
      throw new AuthError('PASSKEY_VERIFICATION_FAILED', 'Passkey 验证失败', 401);
    }
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      throw new AuthError('PASSKEY_VERIFICATION_FAILED', 'Passkey 验证失败', 401);
    }
    await this.repository.updateCredentialCounter(
      credential.id,
      verification.authenticationInfo.newCounter,
      this.clock()
    );
    const session = await this.authService.createVerifiedSession(user);
    await this.authService.audit({
      requestId: input.requestId,
      actorId: user.id,
      action: 'auth.passkey.login',
      resourceKind: 'session',
      resourceId: session.session.sessionId,
      outcome: 'success',
      reasonCode: 'PASSKEY_LOGIN_SUCCEEDED'
    });
    return session;
  }

  async registerOptions(
    user: AuthUser,
    ceremony: PasskeyCeremonyContext
  ): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const credentials = await this.repository.listCredentials(user.id);
    const options = await generateRegistrationOptions({
      rpName: 'oneVegetable',
      rpID: ceremony.rpId,
      userName: user.username,
      userDisplayName: user.username,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports
      })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required'
      }
    });
    const challengeId = await this.#storeChallenge('register', options.challenge, ceremony, {
      userId: user.id
    });
    return { challengeId, options };
  }

  async registerVerify(input: {
    requestId: string;
    actor: AuthPrincipal;
    challengeId: string;
    response: unknown;
    credentialName?: string;
  }): Promise<PasskeyCredentialSummary> {
    const challenge = await this.#takeChallenge(input.challengeId, 'register');
    const userId = readContextString(challenge, 'userId');
    if (userId !== input.actor.actorId)
      throw new AuthError('PASSKEY_CHALLENGE_MISMATCH', 'Passkey 请求已失效', 403);
    const user = await this.#requiredActiveUser(userId);
    const verified = await verifyRegistration(challenge, input.response);
    const saved = await this.#saveCredential(
      user,
      verified,
      challenge.rpId,
      input.credentialName,
      input.actor.actorId
    );
    await this.authService.audit({
      requestId: input.requestId,
      actorId: input.actor.actorId,
      action: 'auth.passkey.register',
      resourceKind: 'passkey',
      resourceId: saved.id,
      outcome: 'success',
      reasonCode: 'PASSKEY_REGISTERED'
    });
    return toSummary(saved);
  }

  async listCredentials(userId: string): Promise<PasskeyCredentialSummary[]> {
    return (await this.repository.listCredentials(userId)).map(toSummary);
  }

  async removeCredential(input: {
    requestId: string;
    actor: AuthPrincipal;
    credentialId: string;
  }): Promise<void> {
    const user = await this.#requiredActiveUser(input.actor.actorId);
    const credentials = await this.repository.listCredentials(user.id);
    if (credentials.length <= 1 && !user.passwordLoginEnabled) {
      throw new AuthError('LAST_AUTHENTICATOR', '不能移除唯一的登录凭据', 409);
    }
    if (!(await this.repository.deleteCredential(input.credentialId, user.id))) {
      throw new AuthError('PASSKEY_NOT_FOUND', 'Passkey 不存在', 400);
    }
    await this.authService.audit({
      requestId: input.requestId,
      actorId: user.id,
      action: 'auth.passkey.remove',
      resourceKind: 'passkey',
      resourceId: input.credentialId,
      outcome: 'success',
      reasonCode: 'PASSKEY_REMOVED'
    });
  }

  async regenerateRecoveryCodes(input: { requestId: string; actor: AuthPrincipal }): Promise<string[]> {
    const codes = await this.#replaceRecoveryCodes(input.actor.actorId);
    await this.authService.audit({
      requestId: input.requestId,
      actorId: input.actor.actorId,
      action: 'auth.recovery-codes.regenerate',
      resourceKind: 'user',
      resourceId: input.actor.actorId,
      outcome: 'success',
      reasonCode: 'RECOVERY_CODES_REGENERATED'
    });
    return codes;
  }

  async recoveryOptions(input: {
    username: string;
    recoveryCode: string;
    ceremony: PasskeyCeremonyContext;
  }): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const user = await this.#requiredActiveUserByName(input.username);
    const codeHash = await sha256Base64Url(normalizeRecoveryCode(input.recoveryCode));
    if (!(await this.repository.hasRecoveryCode(user.id, codeHash))) {
      throw new AuthError('RECOVERY_CODE_INVALID', '恢复码无效或已使用', 401);
    }
    const options = await generateRegistrationOptions({
      rpName: 'oneVegetable',
      rpID: input.ceremony.rpId,
      userName: user.username,
      userDisplayName: user.username,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required'
      }
    });
    const challengeId = await this.#storeChallenge('recovery', options.challenge, input.ceremony, {
      userId: user.id,
      codeHash
    });
    return { challengeId, options };
  }

  async recoveryVerify(input: {
    requestId: string;
    challengeId: string;
    response: unknown;
    credentialName?: string;
  }): Promise<PasskeySessionResult> {
    const challenge = await this.#takeChallenge(input.challengeId, 'recovery');
    const userId = readContextString(challenge, 'userId');
    const codeHash = readContextString(challenge, 'codeHash');
    const user = await this.#requiredActiveUser(userId);
    const verified = await verifyRegistration(challenge, input.response);
    if (!(await this.repository.consumeRecoveryCode(user.id, codeHash, this.clock()))) {
      throw new AuthError('RECOVERY_CODE_INVALID', '恢复码无效或已使用', 401);
    }
    await this.#saveCredential(user, verified, challenge.rpId, input.credentialName, user.id);
    await this.authRepository.deleteSessionsForUser(user.id);
    const recoveryCodes = await this.#replaceRecoveryCodes(user.id);
    const session = await this.authService.createVerifiedSession(user);
    await this.authService.audit({
      requestId: input.requestId,
      actorId: user.id,
      action: 'auth.passkey.recover',
      resourceKind: 'user',
      resourceId: user.id,
      outcome: 'success',
      reasonCode: 'PASSKEY_RECOVERY_SUCCEEDED'
    });
    return { ...session, recoveryCodes };
  }

  async createEnrollment(input: {
    requestId: string;
    actor: AuthPrincipal;
    username: string;
    role: UserRole;
    remark?: string | null;
  }): Promise<{ user: PublicUser; enrollmentToken: string; expiresTimeUtc: number }> {
    const username = normalizeUsername(input.username);
    if (await this.authRepository.findUserByUsername(username)) {
      throw new AuthError('USERNAME_EXISTS', '用户名已存在', 409);
    }
    const now = this.clock();
    const user = await this.authRepository.createUser({
      id: crypto.randomUUID(),
      username,
      passwordHash: 'passkey-only',
      passwordSalt: randomToken(16),
      passwordLoginEnabled: false,
      role: input.role,
      status: 'active',
      audit: createEntityAuditFields(input.actor.actorId, now, input.remark)
    });
    const enrollmentToken = randomToken();
    const expiresTimeUtc = now + ENROLLMENT_LIFETIME_MILLISECONDS;
    await this.repository.createEnrollmentToken({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: await sha256Base64Url(enrollmentToken),
      expiresTimeUtc,
      creatorId: input.actor.actorId,
      createTimeUtc: now
    });
    await this.authService.audit({
      requestId: input.requestId,
      actorId: input.actor.actorId,
      action: 'admin.users.enrollment.create',
      resourceKind: 'user',
      resourceId: user.id,
      outcome: 'success',
      reasonCode: 'PASSKEY_ENROLLMENT_CREATED',
      revisionAfter: 1
    });
    return { user: toPublicUser(user), enrollmentToken, expiresTimeUtc };
  }

  async enrollmentOptions(input: {
    enrollmentToken: string;
    ceremony: PasskeyCeremonyContext;
  }): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const tokenHash = await sha256Base64Url(input.enrollmentToken);
    const token = await this.repository.findEnrollmentToken(tokenHash, this.clock());
    if (!token) throw new AuthError('ENROLLMENT_TOKEN_INVALID', '注册链接无效或已过期', 401);
    const user = await this.#requiredActiveUser(token.userId);
    const options = await generateRegistrationOptions({
      rpName: 'oneVegetable',
      rpID: input.ceremony.rpId,
      userName: user.username,
      userDisplayName: user.username,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required'
      }
    });
    const challengeId = await this.#storeChallenge('enrollment', options.challenge, input.ceremony, {
      userId: user.id,
      enrollmentId: token.id
    });
    return { challengeId, options };
  }

  async enrollmentVerify(input: {
    requestId: string;
    challengeId: string;
    response: unknown;
    credentialName?: string;
  }): Promise<PasskeySessionResult> {
    const challenge = await this.#takeChallenge(input.challengeId, 'enrollment');
    const user = await this.#requiredActiveUser(readContextString(challenge, 'userId'));
    const enrollmentId = readContextString(challenge, 'enrollmentId');
    const verified = await verifyRegistration(challenge, input.response);
    if (!(await this.repository.consumeEnrollmentToken(enrollmentId, this.clock()))) {
      throw new AuthError('ENROLLMENT_TOKEN_INVALID', '注册链接无效或已过期', 401);
    }
    await this.#saveCredential(user, verified, challenge.rpId, input.credentialName, user.id);
    const recoveryCodes = await this.#replaceRecoveryCodes(user.id);
    const session = await this.authService.createVerifiedSession(user);
    await this.authService.audit({
      requestId: input.requestId,
      actorId: user.id,
      action: 'auth.passkey.enrollment.complete',
      resourceKind: 'user',
      resourceId: user.id,
      outcome: 'success',
      reasonCode: 'PASSKEY_ENROLLMENT_COMPLETED'
    });
    return { ...session, recoveryCodes };
  }

  async #assertBootstrap(token: string): Promise<void> {
    if (
      !this.bootstrapToken ||
      (await sha256Base64Url(token)) !== (await sha256Base64Url(this.bootstrapToken))
    ) {
      throw new AuthError('INVALID_BOOTSTRAP_TOKEN', '初始化令牌无效', 403);
    }
    if ((await this.authRepository.countUsers()) !== 0) {
      throw new AuthError('BOOTSTRAP_ALREADY_COMPLETED', '首个管理员已经创建', 409);
    }
  }

  async #storeChallenge(
    kind: PasskeyChallengeKind,
    challenge: string,
    ceremony: PasskeyCeremonyContext,
    context: Record<string, unknown>
  ): Promise<string> {
    const now = this.clock();
    const id = crypto.randomUUID();
    await this.repository.createChallenge(
      {
        id,
        challenge,
        kind,
        userId: kind === 'bootstrap' ? null : typeof context.userId === 'string' ? context.userId : null,
        username: typeof context.username === 'string' ? context.username : null,
        rpId: ceremony.rpId,
        origin: ceremony.origin,
        context,
        expiresTimeUtc: now + CHALLENGE_LIFETIME_MILLISECONDS
      },
      now
    );
    return id;
  }

  async #takeChallenge(id: string, kind: PasskeyChallengeKind): Promise<StoredPasskeyChallenge> {
    const challenge = await this.repository.takeChallenge(id, kind, this.clock());
    if (!challenge) throw new AuthError('PASSKEY_CHALLENGE_INVALID', 'Passkey 请求已过期或已使用', 401);
    return challenge;
  }

  async #saveCredential(
    user: AuthUser,
    verified: Awaited<ReturnType<typeof verifyRegistration>>,
    rpId: string,
    requestedName: string | undefined,
    actorId: string
  ): Promise<StoredPasskeyCredential> {
    const credential: StoredPasskeyCredential = {
      id: verified.credential.id,
      userId: user.id,
      publicKey: Uint8Array.from(verified.credential.publicKey),
      counter: verified.credential.counter,
      transports: verified.credential.transports ?? [],
      deviceType: verified.credentialDeviceType,
      backedUp: verified.credentialBackedUp,
      rpId,
      name: normalizeCredentialName(requestedName),
      createTimeUtc: this.clock()
    };
    await this.repository.createCredential(credential, actorId, this.clock());
    return credential;
  }

  async #replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomToken(18));
    const hashes = await Promise.all(codes.map((code) => sha256Base64Url(code)));
    await this.repository.replaceRecoveryCodes(userId, hashes, this.clock());
    return codes;
  }

  async #requiredActiveUser(userId: string): Promise<AuthUser> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new AuthError('USER_NOT_FOUND', '用户不存在', 401);
    if (user.status !== 'active') throw new AuthError('USER_DISABLED', '账号已停用', 403);
    return user;
  }

  async #requiredActiveUserByName(username: string): Promise<AuthUser> {
    const user = await this.authRepository.findUserByUsername(normalizeUsername(username));
    if (!user) throw new AuthError('RECOVERY_CODE_INVALID', '恢复码无效或已使用', 401);
    return this.#requiredActiveUser(user.id);
  }
}

async function verifyRegistration(challenge: StoredPasskeyChallenge, raw: unknown) {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: readRegistrationResponse(raw),
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
      requireUserVerification: true
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('PASSKEY_VERIFICATION_FAILED', 'Passkey 验证失败', 401);
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    throw new AuthError('PASSKEY_VERIFICATION_FAILED', 'Passkey 验证失败', 401);
  }
  return verification.registrationInfo;
}

function readRegistrationResponse(value: unknown): RegistrationResponseJSON {
  if (!isObject(value) || typeof value.id !== 'string' || !isObject(value.response)) {
    throw new AuthError('PASSKEY_RESPONSE_INVALID', 'Passkey 注册响应无效', 400);
  }
  return value as unknown as RegistrationResponseJSON;
}

function readAuthenticationResponse(value: unknown): AuthenticationResponseJSON {
  if (!isObject(value) || typeof value.id !== 'string' || !isObject(value.response)) {
    throw new AuthError('PASSKEY_RESPONSE_INVALID', 'Passkey 登录响应无效', 400);
  }
  return value as unknown as AuthenticationResponseJSON;
}

function toWebAuthnCredential(credential: StoredPasskeyCredential) {
  return {
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports
  };
}

function toSummary(credential: StoredPasskeyCredential): PasskeyCredentialSummary {
  return {
    id: credential.id,
    name: credential.name,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    rpId: credential.rpId,
    createTimeUtc: credential.createTimeUtc
  };
}

function readContextString(challenge: StoredPasskeyChallenge, key: string): string {
  const value = challenge.context[key];
  if (typeof value !== 'string')
    throw new AuthError('PASSKEY_CHALLENGE_INVALID', 'Passkey 请求上下文无效', 401);
  return value;
}

function normalizeUsername(value: string): string {
  const username = value.trim().toLocaleLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw new AuthError('INVALID_USERNAME', '用户名需为 3–64 位字母、数字、点、下划线或横线', 400);
  }
  return username;
}

function normalizeCredentialName(value: string | undefined): string {
  const requestedName = value?.trim();
  const name = requestedName === undefined || requestedName === '' ? 'Passkey' : requestedName;
  if (name.length > 80) throw new AuthError('PASSKEY_NAME_INVALID', 'Passkey 名称不能超过 80 个字符', 400);
  return name;
}

function normalizeRecoveryCode(value: string): string {
  const code = value.trim();
  if (code.length < 16 || code.length > 128)
    throw new AuthError('RECOVERY_CODE_INVALID', '恢复码无效或已使用', 401);
  return code;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
