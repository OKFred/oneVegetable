import {
  createAlibabaCredentialAcquisitionCompletedSummary,
  createAlibabaCredentialAcquisitionFailure,
  createAlibabaCredentialAcquisitionState,
  optionalAlibabaCredentialCallbackUrl,
  transitionAlibabaCredentialAcquisitionState
} from '@one-vegetable/core';

import {
  AlibabaCredentialAcquisitionBusyError,
  AlibabaCredentialAcquisitionRateLimitError
} from './repository';

import type {
  AlibabaCredentialAcquisitionContinueCommand,
  AlibabaCredentialAcquisitionExtensionFallbackReason,
  AlibabaCredentialAcquisitionFailureCode,
  AlibabaCredentialAcquisitionState,
  AlibabaCredentialApplicationSummary,
  AlibabaOpenApiCredentialBundle
} from '@one-vegetable/core';
import type { GatewayCredentialService } from '../gateway/credential-vault';
import type {
  AlibabaCredentialAcquisitionJob,
  AlibabaCredentialAcquisitionJobRepository
} from './repository';

export type AlibabaCredentialAcquisitionDriverResult =
  | {
      kind: 'selection-required';
      applications: AlibabaCredentialApplicationSummary[];
    }
  | {
      kind: 'callback-confirmation-required';
      selectedApplicationId: string;
      currentUrl: string;
      requestedUrl: string;
    }
  | { kind: 'completed'; bundle: AlibabaOpenApiCredentialBundle }
  | { kind: 'extension-required'; reasonCode: AlibabaCredentialAcquisitionExtensionFallbackReason }
  | { kind: 'failed'; code: AlibabaCredentialAcquisitionFailureCode };

export interface AlibabaCredentialAcquisitionDriver {
  start(input: {
    requestId: string;
    jobId: string;
    account: string;
    password: string;
    requestedCallbackUrl: string | null;
    onSessionAcquired: (sessionId: string) => Promise<void>;
  }): Promise<AlibabaCredentialAcquisitionDriverResult>;
  continue(input: {
    requestId: string;
    job: AlibabaCredentialAcquisitionJob;
    command: AlibabaCredentialAcquisitionContinueCommand;
  }): Promise<AlibabaCredentialAcquisitionDriverResult>;
  cancel(browserSessionId: string): Promise<void>;
}

export class AlibabaCredentialAcquisitionServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503
  ) {
    super(message);
    this.name = 'AlibabaCredentialAcquisitionServiceError';
  }
}

export class AlibabaCredentialAcquisitionService {
  constructor(
    private readonly repository: AlibabaCredentialAcquisitionJobRepository,
    private readonly driver: AlibabaCredentialAcquisitionDriver,
    private readonly credentialService: GatewayCredentialService,
    private readonly clock: () => number = Date.now
  ) {}

  async start(input: {
    requestId: string;
    actorId: string;
    account: string;
    password: string;
    callbackUrl: string | null;
  }): Promise<AlibabaCredentialAcquisitionState> {
    const account = normalizeSecretInput(input.account, 512, '账号');
    const password = normalizeSecretInput(input.password, 1024, '密码');
    const requestedCallbackUrl = optionalAlibabaCredentialCallbackUrl(input.callbackUrl)?.href ?? null;
    const now = this.clock();
    const jobId = crypto.randomUUID();
    const initial = createAlibabaCredentialAcquisitionState(jobId, now);
    try {
      await this.repository.create({
        id: jobId,
        actorId: input.actorId,
        state: initial,
        requestedCallbackUrl,
        now
      });
    } catch (error: unknown) {
      if (error instanceof AlibabaCredentialAcquisitionBusyError) {
        throw new AlibabaCredentialAcquisitionServiceError(
          'ACQUISITION_BUSY',
          '已有管理员正在获取 Alibaba 凭据，请稍后再试',
          409
        );
      }
      if (error instanceof AlibabaCredentialAcquisitionRateLimitError) {
        throw new AlibabaCredentialAcquisitionServiceError(
          'ACQUISITION_RATE_LIMITED',
          '30 分钟内最多启动 3 次，请稍后再试',
          429
        );
      }
      throw error;
    }

    let result: AlibabaCredentialAcquisitionDriverResult;
    try {
      result = await this.driver.start({
        requestId: input.requestId,
        jobId,
        account,
        password,
        requestedCallbackUrl,
        onSessionAcquired: async (sessionId) => {
          await this.repository.attachBrowserSession(jobId, input.actorId, sessionId, this.clock());
        }
      });
    } catch {
      result = { kind: 'extension-required', reasonCode: 'browser-unavailable' };
    }
    return await this.applyDriverResult(jobId, input.actorId, result);
  }

  async continue(input: {
    requestId: string;
    actorId: string;
    jobId: string;
    command: AlibabaCredentialAcquisitionContinueCommand;
  }): Promise<AlibabaCredentialAcquisitionState> {
    const job = await this.requireActive(input.jobId, input.actorId);
    assertCommandMatchesState(job.state, input.command);
    const selectedApplicationId =
      input.command.type === 'select-application'
        ? assertSelectedApplication(job.state, input.command.applicationId)
        : job.selectedApplicationId;
    const resumedState = transitionAlibabaCredentialAcquisitionState(
      job.state,
      { type: 'resume' },
      this.clock()
    );
    const resumed = await this.repository.update({
      id: job.id,
      actorId: input.actorId,
      state: resumedState,
      ...(selectedApplicationId ? { selectedApplicationId } : {}),
      now: this.clock()
    });
    let result: AlibabaCredentialAcquisitionDriverResult;
    try {
      result = await this.driver.continue({
        requestId: input.requestId,
        job: resumed,
        command: input.command
      });
    } catch {
      result = { kind: 'extension-required', reasonCode: 'session-expired' };
    }
    return await this.applyDriverResult(job.id, input.actorId, result);
  }

  async status(actorId: string, jobId: string): Promise<AlibabaCredentialAcquisitionState> {
    const job = await this.requireOwned(jobId, actorId);
    if (isActive(job.state) && this.clock() >= job.expiresTimeUtc) {
      await this.closeSession(job.browserSessionId);
      const state: AlibabaCredentialAcquisitionState = {
        status: 'failed',
        error: createAlibabaCredentialAcquisitionFailure('ACQUISITION_EXPIRED')
      };
      return (await this.repository.update({ id: job.id, actorId, state, now: this.clock() })).state;
    }
    return job.state;
  }

  async cancel(actorId: string, jobId: string): Promise<AlibabaCredentialAcquisitionState> {
    const job = await this.requireOwned(jobId, actorId);
    if (!isActive(job.state)) return job.state;
    await this.closeSession(job.browserSessionId);
    const state: AlibabaCredentialAcquisitionState = {
      status: 'failed',
      error: createAlibabaCredentialAcquisitionFailure('ACQUISITION_CANCELLED')
    };
    return (await this.repository.update({ id: job.id, actorId, state, now: this.clock() })).state;
  }

  private async applyDriverResult(
    jobId: string,
    actorId: string,
    result: AlibabaCredentialAcquisitionDriverResult
  ): Promise<AlibabaCredentialAcquisitionState> {
    const job = await this.requireActive(jobId, actorId);
    let state: AlibabaCredentialAcquisitionState;
    let selectedApplicationId: string | undefined;
    if (result.kind === 'selection-required') {
      state = transitionAlibabaCredentialAcquisitionState(
        job.state,
        { type: 'require-application-selection', applications: result.applications },
        this.clock()
      );
    } else if (result.kind === 'callback-confirmation-required') {
      selectedApplicationId = result.selectedApplicationId;
      state = transitionAlibabaCredentialAcquisitionState(
        job.state,
        {
          type: 'require-callback-confirmation',
          currentUrl: result.currentUrl,
          requestedUrl: result.requestedUrl
        },
        this.clock()
      );
    } else if (result.kind === 'extension-required') {
      state = transitionAlibabaCredentialAcquisitionState(
        job.state,
        { type: 'require-extension', reasonCode: result.reasonCode },
        this.clock()
      );
      await this.closeSession(job.browserSessionId);
    } else if (result.kind === 'failed') {
      state = transitionAlibabaCredentialAcquisitionState(
        job.state,
        { type: 'fail', code: result.code },
        this.clock()
      );
      await this.closeSession(job.browserSessionId);
    } else {
      try {
        const current = await this.credentialService.status();
        await this.credentialService.import({
          bundle: result.bundle,
          actorId,
          expectedRevision: current.revision,
          remark: 'Alibaba Browser Run 自动获取'
        });
      } catch {
        state = transitionAlibabaCredentialAcquisitionState(
          job.state,
          { type: 'fail', code: 'CREDENTIAL_STORE_FAILED' },
          this.clock()
        );
        await this.closeSession(job.browserSessionId);
        return (await this.repository.update({ id: job.id, actorId, state, now: this.clock() })).state;
      }
      state = transitionAlibabaCredentialAcquisitionState(
        job.state,
        { type: 'complete', credential: createAlibabaCredentialAcquisitionCompletedSummary(result.bundle) },
        this.clock()
      );
      await this.closeSession(job.browserSessionId);
    }
    return (
      await this.repository.update({
        id: job.id,
        actorId,
        state,
        ...(selectedApplicationId ? { selectedApplicationId } : {}),
        now: this.clock()
      })
    ).state;
  }

  private async requireActive(id: string, actorId: string): Promise<AlibabaCredentialAcquisitionJob> {
    const job = await this.requireOwned(id, actorId);
    if (!isActive(job.state)) {
      throw new AlibabaCredentialAcquisitionServiceError(
        'ACQUISITION_ALREADY_FINISHED',
        'Alibaba 凭据获取任务已经结束',
        409
      );
    }
    if (this.clock() >= job.expiresTimeUtc) {
      await this.closeSession(job.browserSessionId);
      throw new AlibabaCredentialAcquisitionServiceError(
        'ACQUISITION_EXPIRED',
        'Alibaba 凭据获取任务已过期，请重新开始',
        409
      );
    }
    return job;
  }

  private async requireOwned(id: string, actorId: string): Promise<AlibabaCredentialAcquisitionJob> {
    const job = await this.repository.findOwned(id, actorId);
    if (!job) {
      throw new AlibabaCredentialAcquisitionServiceError(
        'ACQUISITION_NOT_FOUND',
        'Alibaba 凭据获取任务不存在',
        404
      );
    }
    return job;
  }

  private async closeSession(sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    await this.driver.cancel(sessionId).catch(() => undefined);
  }
}

function assertCommandMatchesState(
  state: AlibabaCredentialAcquisitionState,
  command: AlibabaCredentialAcquisitionContinueCommand
): void {
  if (
    (state.status === 'selection-required' && command.type !== 'select-application') ||
    (state.status === 'callback-confirmation-required' && command.type !== 'confirm-callback-change') ||
    (state.status !== 'selection-required' && state.status !== 'callback-confirmation-required')
  ) {
    throw new AlibabaCredentialAcquisitionServiceError(
      'ACQUISITION_COMMAND_INVALID',
      '当前任务状态不接受这个操作',
      409
    );
  }
}

function assertSelectedApplication(state: AlibabaCredentialAcquisitionState, applicationId: string): string {
  if (
    state.status !== 'selection-required' ||
    !state.applications.some((application) => application.applicationId === applicationId)
  ) {
    throw new AlibabaCredentialAcquisitionServiceError(
      'APPLICATION_SELECTION_INVALID',
      '所选 Alibaba 应用不存在',
      400
    );
  }
  return applicationId;
}

function isActive(state: AlibabaCredentialAcquisitionState): boolean {
  return (
    state.status === 'running' ||
    state.status === 'selection-required' ||
    state.status === 'callback-confirmation-required'
  );
}

function normalizeSecretInput(value: string, maxLength: number, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AlibabaCredentialAcquisitionServiceError('INVALID_REQUEST_BODY', `${label}无效`, 400);
  }
  return normalized;
}
