import {
  AlibabaClient,
  findCapability,
  GatewayException,
  getCapabilityDefinition,
  listCapabilities,
  NetworkManager,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '@one-vegetable/core';

import type {
  CapabilityCallRequest,
  GatewayClient,
  GatewayCredentials,
  NetworkTransport,
  OperationId,
  RequestOf,
  ResponseOf
} from '@one-vegetable/core';

export interface GatewayRequestContext {
  requestId: string;
}

export interface AlibabaReadGatewayOptions {
  transport?: NetworkTransport;
  wait?: (milliseconds: number) => Promise<void>;
}

export class AlibabaReadGatewayClient implements GatewayClient {
  readonly #credentials: GatewayCredentials;
  readonly #network: NetworkManager;
  readonly #wait: ((milliseconds: number) => Promise<void>) | undefined;

  constructor(credentials: GatewayCredentials, options: AlibabaReadGatewayOptions = {}) {
    this.#credentials = credentials;
    this.#wait = options.wait;
    this.#network = new NetworkManager({
      ...(options.transport ? { transport: options.transport } : {}),
      ...(options.wait ? { wait: options.wait } : {}),
      policies: {
        alibaba: {
          allowedOrigins: [new URL(credentials.endpoint).origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 30 * 1024 * 1024,
          maxResponseBytes: 30 * 1024 * 1024,
          defaultHeaders: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
          redirect: 'error'
        },
        bff: { allowedOrigins: [] },
        'external-photo': { allowedOrigins: [] }
      }
    });
  }

  async request<K extends OperationId>(
    operation: K,
    request: RequestOf<K>,
    context?: GatewayRequestContext
  ): Promise<ResponseOf<K>> {
    if (operation === 'listCapabilities') return listCapabilities();
    if (operation === 'getCapabilityDefinition') {
      const method = readString(readRecord(request), 'method');
      const definition = getCapabilityDefinition(method);
      if (!definition) throw gatewayError('CAPABILITY_UNKNOWN', '该能力尚无类型化定义');
      return definition;
    }
    if (operation !== 'callCapability') {
      throw gatewayError(
        'BFF_REAL_OPERATION_UNAVAILABLE',
        '该专用操作尚未完成 BFF 只读适配，请使用类型化能力调试入口'
      );
    }

    const payload = request as CapabilityCallRequest;
    const capability = findCapability(payload.method);
    if (!capability) throw gatewayError('CAPABILITY_UNKNOWN', '该能力不在审计目录中');
    if (!capability.enabled || capability.lifecycle !== 'active') {
      throw gatewayError('CAPABILITY_NOT_ACTIVE', '该能力未处于可调用状态');
    }
    if (capability.restricted) {
      throw gatewayError('CAPABILITY_RESTRICTED', capability.restrictionReason ?? '该能力需要额外资格');
    }
    if (capability.risk !== 'read' || !capability.realCallEnabled) {
      throw gatewayError('REAL_MUTATION_DISABLED', 'BFF 真实写能力保持关闭');
    }

    const requestIssues = await validateCapabilityRequest(payload.method, payload.parameters);
    if (requestIssues.length > 0) {
      throw gatewayError(
        'REQUEST_CONTRACT_INVALID',
        requestIssues.map((issue) => `${issue.instancePath} ${issue.message}`).join('；')
      );
    }
    const client = new AlibabaClient(this.#credentials, this.#network, {
      maxAttempts: 3,
      shouldRetry: (_method, error) => error.retryable,
      ...(this.#wait ? { wait: this.#wait } : {}),
      ...(context ? { requestId: context.requestId } : {})
    });
    const call = await client.call(payload.method, payload.parameters);
    const data = unwrapAlibabaResponse(call.data, payload.method);
    const contractIssues = await validateCapabilityResponse(payload.method, data);
    return {
      method: payload.method,
      traceId: readTraceId(call.data) ?? context?.requestId ?? crypto.randomUUID(),
      data,
      contractValid: contractIssues.length === 0,
      contractIssues
    } as ResponseOf<K>;
  }
}

function gatewayError(code: string, message: string): GatewayException {
  return new GatewayException({ code, message, retryable: false });
}

function unwrapAlibabaResponse(value: unknown, method: string): unknown {
  const record = readRecord(value);
  const key = `${method.replaceAll('.', '_')}_response`;
  return key in record ? record[key] : value;
}

function readTraceId(value: unknown): string | null {
  const record = readRecord(value);
  for (const key of ['request_id', 'trace_id']) {
    if (typeof record[key] === 'string') return record[key];
  }
  for (const nested of Object.values(record)) {
    const child = readRecord(nested);
    for (const key of ['request_id', 'trace_id']) {
      if (typeof child[key] === 'string') return child[key];
    }
  }
  return null;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '')
    throw gatewayError('INVALID_OPERATION_REQUEST', `${key} 无效`);
  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
