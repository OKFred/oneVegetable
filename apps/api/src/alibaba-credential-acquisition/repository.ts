import {
  ALIBABA_CREDENTIAL_ACQUISITION_RATE_LIMIT_MAXIMUM,
  ALIBABA_CREDENTIAL_ACQUISITION_RATE_LIMIT_WINDOW_MILLISECONDS,
  createAlibabaCredentialAcquisitionFailure,
  validateAlibabaCredentialAcquisitionStateInput
} from '@one-vegetable/core';

import type { AlibabaCredentialAcquisitionState } from '@one-vegetable/core';
import type { SqlExecutor } from '../db/sql-executor';

export interface AlibabaCredentialAcquisitionJob {
  id: string;
  actorId: string;
  browserSessionId: string | null;
  state: AlibabaCredentialAcquisitionState;
  selectedApplicationId: string | null;
  requestedCallbackUrl: string | null;
  expiresTimeUtc: number;
  createTimeUtc: number;
  updateTimeUtc: number;
}

export interface AlibabaCredentialAcquisitionJobRepository {
  create(input: {
    id: string;
    actorId: string;
    state: AlibabaCredentialAcquisitionState;
    requestedCallbackUrl: string | null;
    now: number;
  }): Promise<AlibabaCredentialAcquisitionJob>;
  findOwned(id: string, actorId: string): Promise<AlibabaCredentialAcquisitionJob | null>;
  attachBrowserSession(id: string, actorId: string, browserSessionId: string, now: number): Promise<void>;
  update(input: {
    id: string;
    actorId: string;
    state: AlibabaCredentialAcquisitionState;
    selectedApplicationId?: string | null;
    now: number;
  }): Promise<AlibabaCredentialAcquisitionJob>;
  expire(now: number): Promise<void>;
}

export class AlibabaCredentialAcquisitionBusyError extends Error {
  constructor() {
    super('已有 Alibaba 凭据获取任务正在运行');
    this.name = 'AlibabaCredentialAcquisitionBusyError';
  }
}

export class AlibabaCredentialAcquisitionRateLimitError extends Error {
  constructor() {
    super('30 分钟内最多启动 3 次 Alibaba 凭据获取任务');
    this.name = 'AlibabaCredentialAcquisitionRateLimitError';
  }
}

export class SqlAlibabaCredentialAcquisitionJobRepository implements AlibabaCredentialAcquisitionJobRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async create(input: {
    id: string;
    actorId: string;
    state: AlibabaCredentialAcquisitionState;
    requestedCallbackUrl: string | null;
    now: number;
  }): Promise<AlibabaCredentialAcquisitionJob> {
    assertPublicState(input.state);
    await this.expire(input.now);
    const recentCutoff = input.now - ALIBABA_CREDENTIAL_ACQUISITION_RATE_LIMIT_WINDOW_MILLISECONDS;
    const recent = await this.executor.query(
      `SELECT COUNT(*) AS count FROM alibaba_credential_acquisition_jobs
       WHERE actor_id = ? AND create_time_utc >= ?`,
      [input.actorId, recentCutoff]
    );
    if (readNumber(recent[0] ?? {}, 'count') >= ALIBABA_CREDENTIAL_ACQUISITION_RATE_LIMIT_MAXIMUM) {
      throw new AlibabaCredentialAcquisitionRateLimitError();
    }
    try {
      await this.executor.execute(
        `INSERT INTO alibaba_credential_acquisition_jobs (
          id, actor_id, browser_session_id, status, state_json, selected_application_id,
          requested_callback_url, active_slot, expires_time_utc, create_time_utc, update_time_utc
        ) VALUES (?, ?, NULL, ?, ?, NULL, ?, 1, ?, ?, ?)`,
        [
          input.id,
          input.actorId,
          input.state.status,
          JSON.stringify(input.state),
          input.requestedCallbackUrl,
          expiration(input.state),
          input.now,
          input.now
        ]
      );
    } catch (error: unknown) {
      if (error instanceof Error && /active_unique|UNIQUE constraint failed/iu.test(error.message)) {
        throw new AlibabaCredentialAcquisitionBusyError();
      }
      throw error;
    }
    return await this.requireOwned(input.id, input.actorId);
  }

  async findOwned(id: string, actorId: string): Promise<AlibabaCredentialAcquisitionJob | null> {
    const rows = await this.executor.query(
      'SELECT * FROM alibaba_credential_acquisition_jobs WHERE id = ? AND actor_id = ? LIMIT 1',
      [id, actorId]
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async attachBrowserSession(
    id: string,
    actorId: string,
    browserSessionId: string,
    now: number
  ): Promise<void> {
    const result = await this.executor.execute(
      `UPDATE alibaba_credential_acquisition_jobs
       SET browser_session_id = ?, update_time_utc = ?
       WHERE id = ? AND actor_id = ? AND active_slot = 1`,
      [normalizeSessionId(browserSessionId), now, id, actorId]
    );
    if (result.changes !== 1) throw new Error('Alibaba 凭据获取任务不存在或已经结束');
  }

  async update(input: {
    id: string;
    actorId: string;
    state: AlibabaCredentialAcquisitionState;
    selectedApplicationId?: string | null;
    now: number;
  }): Promise<AlibabaCredentialAcquisitionJob> {
    assertPublicState(input.state);
    const terminal = isTerminal(input.state);
    const result = await this.executor.execute(
      `UPDATE alibaba_credential_acquisition_jobs
       SET status = ?, state_json = ?, selected_application_id = COALESCE(?, selected_application_id),
           active_slot = ?, update_time_utc = ?
       WHERE id = ? AND actor_id = ?`,
      [
        input.state.status,
        JSON.stringify(input.state),
        input.selectedApplicationId ?? null,
        terminal ? null : 1,
        input.now,
        input.id,
        input.actorId
      ]
    );
    if (result.changes !== 1) throw new Error('Alibaba 凭据获取任务不存在');
    return await this.requireOwned(input.id, input.actorId);
  }

  async expire(now: number): Promise<void> {
    const state = JSON.stringify({
      status: 'failed',
      error: createAlibabaCredentialAcquisitionFailure('ACQUISITION_EXPIRED')
    } satisfies AlibabaCredentialAcquisitionState);
    await this.executor.execute(
      `UPDATE alibaba_credential_acquisition_jobs
       SET status = 'failed', state_json = ?, active_slot = NULL, update_time_utc = ?
       WHERE active_slot = 1 AND expires_time_utc <= ?`,
      [state, now, now]
    );
  }

  private async requireOwned(id: string, actorId: string): Promise<AlibabaCredentialAcquisitionJob> {
    const job = await this.findOwned(id, actorId);
    if (!job) throw new Error('Alibaba 凭据获取任务不存在');
    return job;
  }
}

function toJob(row: Record<string, unknown>): AlibabaCredentialAcquisitionJob {
  return {
    id: readString(row, 'id'),
    actorId: readString(row, 'actor_id'),
    browserSessionId: readNullableString(row, 'browser_session_id'),
    state: parseState(readString(row, 'state_json')),
    selectedApplicationId: readNullableString(row, 'selected_application_id'),
    requestedCallbackUrl: readNullableString(row, 'requested_callback_url'),
    expiresTimeUtc: readNumber(row, 'expires_time_utc'),
    createTimeUtc: readNumber(row, 'create_time_utc'),
    updateTimeUtc: readNumber(row, 'update_time_utc')
  };
}

function parseState(value: string): AlibabaCredentialAcquisitionState {
  const parsed = JSON.parse(value) as unknown;
  assertPublicState(parsed);
  return parsed;
}

function assertPublicState(value: unknown): asserts value is AlibabaCredentialAcquisitionState {
  const validation = validateAlibabaCredentialAcquisitionStateInput(value);
  if (!validation.valid) throw new Error(`凭据获取任务状态无效：${validation.errors.join('；')}`);
  const serialized = JSON.stringify(value);
  if (/"(?:account|password|appSecret|accessToken|refreshToken|authorizationCode)"\s*:/iu.test(serialized)) {
    throw new Error('凭据获取任务状态包含敏感字段');
  }
}

function expiration(state: AlibabaCredentialAcquisitionState): number {
  if (
    state.status === 'running' ||
    state.status === 'selection-required' ||
    state.status === 'callback-confirmation-required'
  ) {
    return state.expiresAtUtc;
  }
  throw new Error('新任务状态必须包含过期时间');
}

function isTerminal(state: AlibabaCredentialAcquisitionState): boolean {
  return (
    state.status === 'extension-required' ||
    state.status === 'completed' ||
    state.status === 'failed' ||
    state.status === 'prerequisite-required'
  );
}

function normalizeSessionId(value: string): string {
  const result = value.trim();
  if (!result || result.length > 256) throw new Error('Browser Run session ID 无效');
  return result;
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return readString(row, key);
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`数据库字段 ${key} 无效`);
  return value;
}
