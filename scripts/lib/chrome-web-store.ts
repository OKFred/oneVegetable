const API_ORIGIN = 'https://chromewebstore.googleapis.com';
const ITEM_ID_PATTERN = /^[a-p]{32}$/;
const PUBLISHER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UPLOAD_STATES = new Set([
  'UPLOAD_STATE_UNSPECIFIED',
  'SUCCEEDED',
  'IN_PROGRESS',
  'UPLOAD_IN_PROGRESS',
  'FAILED',
  'NOT_FOUND'
]);

export interface ChromeWebStoreTarget {
  publisherId: string;
  itemId: string;
}

export interface ExtensionReleaseManifest {
  schemaVersion: 1;
  extensionVersion: string;
  artifact: string;
  sha256: string;
  size: number;
  fileCount: number;
}

export interface ChromeWebStoreHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

export interface ChromeWebStoreHttpResponse {
  status: number;
  body: unknown;
}

export type ChromeWebStoreTransport = (
  request: ChromeWebStoreHttpRequest
) => Promise<ChromeWebStoreHttpResponse>;

export interface DraftUploadResult {
  itemId: string;
  crxVersion: string | null;
  uploadState: string;
  pollAttempts: number;
}

interface UploadOptions {
  pollAttempts?: number;
  pollIntervalMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function chromeWebStoreTargetFromEnvironment(environment: NodeJS.ProcessEnv): ChromeWebStoreTarget {
  const publisherId = environment.CHROME_WEB_STORE_PUBLISHER_ID?.trim() ?? '';
  const itemId = environment.CHROME_WEB_STORE_ITEM_ID?.trim() ?? '';
  if (!PUBLISHER_ID_PATTERN.test(publisherId)) {
    throw new Error('CHROME_WEB_STORE_PUBLISHER_ID is missing or invalid.');
  }
  if (!ITEM_ID_PATTERN.test(itemId)) {
    throw new Error('CHROME_WEB_STORE_ITEM_ID must be a 32-character Chrome extension ID.');
  }
  return { publisherId, itemId };
}

export function chromeWebStoreAccessTokenFromEnvironment(environment: NodeJS.ProcessEnv): string {
  const accessToken = environment.CHROME_WEB_STORE_ACCESS_TOKEN?.trim() ?? '';
  if (accessToken.length < 20 || accessToken.length > 8192 || /\s/u.test(accessToken)) {
    throw new Error('CHROME_WEB_STORE_ACCESS_TOKEN is missing or invalid.');
  }
  return accessToken;
}

export function parseExtensionReleaseManifest(value: unknown): ExtensionReleaseManifest {
  const record = asRecord(value);
  const schemaVersion = record?.schemaVersion;
  const extensionVersion = record?.extensionVersion;
  const artifact = record?.artifact;
  const sha256 = record?.sha256;
  const size = record?.size;
  const fileCount = record?.fileCount;
  if (
    schemaVersion !== 1 ||
    typeof extensionVersion !== 'string' ||
    !VERSION_PATTERN.test(extensionVersion) ||
    typeof artifact !== 'string' ||
    artifact !== `one-vegetable-v${extensionVersion}-chrome-mv3.zip` ||
    typeof sha256 !== 'string' ||
    !SHA256_PATTERN.test(sha256) ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    typeof fileCount !== 'number' ||
    !Number.isSafeInteger(fileCount) ||
    fileCount <= 0
  ) {
    throw new Error('artifacts/release.json is invalid; run pnpm release:extension again.');
  }
  return { schemaVersion, extensionVersion, artifact, sha256, size, fileCount };
}

export function draftUploadUrl(target: ChromeWebStoreTarget): string {
  return `${API_ORIGIN}/upload/v2/publishers/${target.publisherId}/items/${target.itemId}:upload`;
}

export function itemStatusUrl(target: ChromeWebStoreTarget): string {
  return `${API_ORIGIN}/v2/publishers/${target.publisherId}/items/${target.itemId}:fetchStatus`;
}

export class ChromeWebStoreDraftClient {
  constructor(
    private readonly target: ChromeWebStoreTarget,
    private readonly accessToken: string,
    private readonly transport: ChromeWebStoreTransport = nativeChromeWebStoreTransport
  ) {}

  async upload(
    archive: Uint8Array,
    expectedVersion: string,
    options: UploadOptions = {}
  ): Promise<DraftUploadResult> {
    const uploadResponse = await this.request({
      method: 'POST',
      url: draftUploadUrl(this.target),
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(archive.byteLength)
      },
      body: archive
    });
    const upload = parseUploadResponse(uploadResponse, this.target.itemId);
    if (upload.uploadState === 'SUCCEEDED') {
      requireExpectedVersion(upload.crxVersion, expectedVersion);
      return { ...upload, pollAttempts: 0 };
    }
    if (!isUploadInProgress(upload.uploadState)) {
      throw new Error(`Chrome Web Store draft upload ended in state ${upload.uploadState}.`);
    }

    const maximumAttempts = options.pollAttempts ?? 30;
    const interval = options.pollIntervalMilliseconds ?? 2_000;
    const sleep = options.sleep ?? delay;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      await sleep(interval);
      const statusResponse = await this.request({
        method: 'GET',
        url: itemStatusUrl(this.target),
        headers: {}
      });
      const state = parseFetchStatusResponse(statusResponse, this.target.itemId);
      if (state === 'SUCCEEDED') {
        return {
          itemId: upload.itemId,
          crxVersion: upload.crxVersion,
          uploadState: state,
          pollAttempts: attempt
        };
      }
      if (!isUploadInProgress(state)) {
        throw new Error(`Chrome Web Store draft upload ended in state ${state}.`);
      }
    }
    throw new Error(`Chrome Web Store draft upload is still processing after ${maximumAttempts} polls.`);
  }

  private async request(
    request: Omit<ChromeWebStoreHttpRequest, 'headers'> & {
      headers: Record<string, string>;
    }
  ): Promise<unknown> {
    const response = await this.transport({
      ...request,
      headers: {
        ...request.headers,
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`
      }
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(providerFailureMessage(response.status, response.body, this.accessToken));
    }
    return response.body;
  }
}

export async function nativeChromeWebStoreTransport(
  request: ChromeWebStoreHttpRequest
): Promise<ChromeWebStoreHttpResponse> {
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    redirect: 'error',
    signal: AbortSignal.timeout(60_000)
  };
  if (request.body) init.body = Uint8Array.from(request.body).buffer;
  const response = await fetch(request.url, init);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

function parseUploadResponse(
  value: unknown,
  expectedItemId: string
): Omit<DraftUploadResult, 'pollAttempts'> {
  const record = asRecord(value);
  const itemId = record?.itemId;
  const crxVersion = record?.crxVersion;
  const uploadState = record?.uploadState;
  if (
    itemId !== expectedItemId ||
    (crxVersion !== undefined && typeof crxVersion !== 'string') ||
    typeof uploadState !== 'string' ||
    !UPLOAD_STATES.has(uploadState)
  ) {
    throw new Error('Chrome Web Store returned an invalid draft upload response.');
  }
  return { itemId, crxVersion: crxVersion ?? null, uploadState };
}

function parseFetchStatusResponse(value: unknown, expectedItemId: string): string {
  const record = asRecord(value);
  const state = record?.lastAsyncUploadState;
  if (record?.itemId !== expectedItemId || typeof state !== 'string' || !UPLOAD_STATES.has(state)) {
    throw new Error('Chrome Web Store returned an invalid item status response.');
  }
  return state;
}

function requireExpectedVersion(actualVersion: string | null, expectedVersion: string): void {
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Chrome Web Store accepted version ${actualVersion ?? 'unknown'} instead of ${expectedVersion}.`
    );
  }
}

function isUploadInProgress(state: string): boolean {
  return state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS';
}

function providerFailureMessage(status: number, value: unknown, accessToken: string): string {
  const record = asRecord(value);
  const error = asRecord(record?.error);
  const code = safeProviderText(error?.status ?? error?.code, accessToken) ?? 'UNKNOWN';
  const message = safeProviderText(error?.message, accessToken) ?? 'Request failed';
  return `Chrome Web Store API ${status} ${code}: ${message}`;
}

function safeProviderText(value: unknown, accessToken: string): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  return String(value)
    .replaceAll(accessToken, '[REDACTED]')
    .replace(/[\r\n\t]/gu, ' ')
    .slice(0, 500);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
