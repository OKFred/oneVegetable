/** Bounded IOP-only reads: no token refresh, active configuration changes, upload or relation writes. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { NetworkManager, NativeFetchTransport } from '../packages/core/src/network';
import { VideoAdapter } from '../packages/core/src/video';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../packages/core/src/capability-registry';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { atomicWriteJson } from './openapi-auth/storage';

const args = process.argv.slice(2);
const file = args.find((value) => value.startsWith('--credential='))?.slice('--credential='.length);
if (!file || !args.includes('--confirm-read-only') || args.length !== 2)
  throw new Error('Provide --credential=<IOP JSON> --confirm-read-only.');
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(file), 'utf8')) as unknown
);
if (
  bundle.protocol !== 'iop' ||
  (bundle.oauth.expiresAtUtc !== null && Date.parse(bundle.oauth.expiresAtUtc) <= Date.now() + 600_000)
)
  throw new Error('VALID_EXPLICIT_IOP_BUNDLE_REQUIRED');
const native = new NativeFetchTransport();
let requests = 0;
const network = new NetworkManager({
  transport: {
    send(input, init) {
      const request = new Request(input, init);
      if (
        request.method !== 'POST' ||
        request.url !== IOP_BUSINESS_ENDPOINT + '/alibaba/icbu/video/query' ||
        ++requests > 2
      )
        throw new Error('READ_ONLY_BOUNDARY_DENIED');
      return native.send(request);
    }
  },
  policies: { alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] } }
});
const requestId = crypto.randomUUID();
const credentials = {
  protocol: 'iop' as const,
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: bundle.application.appKey,
  appSecret: bundle.application.appSecret,
  accessToken: bundle.oauth.accessToken,
  signMethod: 'hmac-sha256' as const
};
const adapter = new VideoAdapter(
  new AlibabaClient(credentials, network, { maxAttempts: 1, requestId }),
  validateCapabilityRequest,
  validateCapabilityResponse
);
const report = {
  capturedAtUtc: new Date().toISOString(),
  requestId,
  protocol: 'iop',
  configurationChanged: false,
  tokenRequests: 0,
  mutations: 0,
  topRequests: 0,
  status: 'failed',
  count: 0,
  exactIdReadback: false,
  requests: 0,
  errorCode: null as string | null,
  subCode: null as string | null,
  providerTraceId: null as string | null,
  requestMethod: 'POST',
  requestContentType: 'application/x-www-form-urlencoded',
  providerMessage: null as string | null,
  responseIssues: [] as string[],
  playbackTested: false
};
try {
  const page = await adapter.list({ page: 1, pageSize: 20 });
  report.count = page.items.length;
  report.providerTraceId = page.traceId || null;
  report.responseIssues = page.issues;
  report.status = page.items.length ? 'passed' : 'no-data';
  const id = page.items[0]?.id;
  if (id) {
    await new Promise<void>((done) => setTimeout(done, 350));
    const exact = await adapter.list({ page: 1, pageSize: 20, id });
    if (!exact.items.length || exact.items.some((video) => video.id !== id))
      throw new Error('VIDEO_ID_FILTER_NOT_CONFIRMED');
    report.exactIdReadback = true;
  }
} catch (cause) {
  const error = normalizeGatewayError(cause);
  report.status = 'failed';
  report.errorCode = error.code;
  report.subCode = error.subCode ?? null;
  report.providerTraceId = error.traceId ?? null;
  if (['ALIBABA_IOP_API_REJECTED', 'ALIBABA_IOP_BUSINESS_REJECTED'].includes(error.code)) {
    let message = error.message;
    for (const secret of [credentials.appKey, credentials.appSecret, credentials.accessToken])
      if (secret) message = message.replaceAll(secret, '[redacted]');
    report.providerMessage = message.replace(/[\r\n]/gu, ' ').slice(0, 300);
  }
  process.exitCode = 1;
} finally {
  report.requests = requests;
  const path = resolve('artifacts/iop-video-read-validation', `${requestId}.json`);
  await atomicWriteJson(path, report);
  process.stdout.write(JSON.stringify({ ...report, reportPath: path }) + '\n');
}
