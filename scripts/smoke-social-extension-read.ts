import { resolve } from 'node:path';

import {
  createRequestId,
  NetworkManager,
  normalizeApiPrefix,
  sanitizeDiagnosticMessage
} from '../packages/core/src/index';
import { atomicWriteJson } from './openapi-auth/storage';

interface SmokeRequestResult {
  path: string;
  requestId: string;
  statusCode: number;
  durationMilliseconds: number;
}

interface SmokeCallResult {
  data: unknown;
}

const baseUrl = readBaseUrl(process.env.ONE_VEGETABLE_SOCIAL_SMOKE_BASE_URL);
const apiPrefix = normalizeApiPrefix(process.env.ONE_VEGETABLE_SOCIAL_SMOKE_API_PREFIX);
const extensionId = readExtensionId(process.env.ONE_VEGETABLE_SOCIAL_SMOKE_EXTENSION_ID);
const deviceToken = readDeviceToken(process.env.ONE_VEGETABLE_SOCIAL_SMOKE_DEVICE_TOKEN);
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_SOCIAL_SMOKE_OUTPUT ?? 'artifacts/social-extension-smoke/latest.json'
);
const network = new NetworkManager({
  policies: {
    bff: {
      allowedOrigins: [baseUrl.origin],
      timeoutMilliseconds: 15_000,
      maxRequestBytes: 64 * 1024,
      maxResponseBytes: 2 * 1024 * 1024,
      redirect: 'error',
      defaultHeaders: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
        Origin: `chrome-extension://${extensionId}`,
        'X-One-Vegetable-Extension-ID': extensionId
      }
    }
  }
});
const requests: SmokeRequestResult[] = [];

try {
  const destinations = await call('/social/destinations/list', {});
  const posts = await call('/social-posts/list', { limit: 50 });
  const destinationItems = readItems(destinations.data);
  const postItems = readItems(posts.data);
  const report = {
    capturedAtUtc: new Date().toISOString(),
    status: 'passed',
    baseOrigin: baseUrl.origin,
    apiPrefix,
    extensionId,
    mutationAttempted: false,
    destinations: summarizeDestinations(destinationItems),
    jobs: summarizeJobs(postItems),
    requests
  };
  await atomicWriteJson(reportPath, report);
  process.stdout.write(
    `插件社交后端只读 Smoke 通过：目标 ${destinationItems.length} 个，任务 ${postItems.length} 个。\n`
  );
  process.stdout.write(`脱敏报告：${reportPath}\n`);
} catch (error: unknown) {
  await atomicWriteJson(reportPath, {
    capturedAtUtc: new Date().toISOString(),
    status: 'failed',
    baseOrigin: baseUrl.origin,
    apiPrefix,
    extensionId,
    mutationAttempted: false,
    error: summarizeError(error),
    requests
  });
  throw error;
}

async function call(path: string, payload: Record<string, unknown>): Promise<SmokeCallResult> {
  const requestId = createRequestId();
  const response = await network.request({
    service: 'bff',
    url: new URL(`${apiPrefix}${path}`, baseUrl),
    method: 'POST',
    requestId,
    body: JSON.stringify({ requestId, ...payload }),
    responseType: 'json',
    maxAttempts: 1
  });
  requests.push({
    path,
    requestId,
    statusCode: response.status,
    durationMilliseconds: response.durationMilliseconds
  });
  const envelope = asRecord(response.data);
  if (envelope.requestId !== requestId) throw new Error('BFF 响应 requestId 不匹配');
  if (envelope.ok !== true) {
    const failure = asRecord(envelope.error);
    const code = typeof failure.code === 'string' ? failure.code : `HTTP_${response.status}`;
    const message = typeof failure.message === 'string' ? failure.message : '社交后端请求失败';
    throw new SocialExtensionSmokeError(code, message);
  }
  return { data: envelope.data };
}

function readBaseUrl(value: string | undefined): URL {
  if (!value) throw new Error('缺少 ONE_VEGETABLE_SOCIAL_SMOKE_BASE_URL');
  const url = new URL(value.trim());
  const loopback =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !loopback) throw new Error('Smoke 后端地址必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Smoke 后端地址只能包含 Origin');
  }
  return new URL(url.origin);
}

function readExtensionId(value: string | undefined): string {
  if (!value || !/^[a-p]{32}$/u.test(value)) {
    throw new Error('ONE_VEGETABLE_SOCIAL_SMOKE_EXTENSION_ID 不是有效 Chrome 扩展 ID');
  }
  return value;
}

function readDeviceToken(value: string | undefined): string {
  if (!value || !/^ovd_[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new Error('ONE_VEGETABLE_SOCIAL_SMOKE_DEVICE_TOKEN 缺失或格式无效');
  }
  return value;
}

function readItems(value: unknown): Record<string, unknown>[] {
  const items = asRecord(value).items;
  if (!Array.isArray(items)) throw new Error('BFF 列表响应缺少 items');
  return items.map(asRecord);
}

function summarizeDestinations(items: readonly Record<string, unknown>[]): Record<string, number> {
  return {
    total: items.length,
    facebook: items.filter((item) => item.platform === 'facebook').length,
    instagram: items.filter((item) => item.platform === 'instagram').length,
    publishable: items.filter((item) => item.canPublish === true).length
  };
}

function summarizeJobs(items: readonly Record<string, unknown>[]): Record<string, number> {
  const result: Record<string, number> = { total: items.length };
  for (const item of items) {
    const status = typeof item.status === 'string' ? item.status : 'unknown-shape';
    result[status] = (result[status] ?? 0) + 1;
  }
  return result;
}

function summarizeError(error: unknown): { code: string; message: string } {
  if (error instanceof SocialExtensionSmokeError) {
    return { code: error.code, message: sanitizeDiagnosticMessage(error.message) };
  }
  return {
    code: 'SOCIAL_EXTENSION_SMOKE_FAILED',
    message: sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误')
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

class SocialExtensionSmokeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SocialExtensionSmokeError';
  }
}
