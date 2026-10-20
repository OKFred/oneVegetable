/** Explicit, one-shot IOP-only acceptance. Creates test assets, never changes active profiles or products. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { AlibabaClient, createAlibabaFileRequest } from '../packages/core/src/alibaba-client';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import {
  createIopBusinessRequest,
  normalizeIopBusinessResponse
} from '../packages/core/src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT, isRecord } from '../packages/core/src/alibaba-iop';
import { NetworkManager } from '../packages/core/src/network';
import { PhotoAdapter } from '../packages/core/src/photo-adapter';
import { downloadProductAsset } from '../packages/core/src/photo-transfer';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { atomicWriteJson } from './openapi-auth/storage';
import { confirmedEmptyPhotoChild, confirmedPhotoChildRemoved } from './lib/iop-photo-delete-proof';
import type { GatewayCredentials, PhotoGroupOperationRequest } from '../packages/core/src/types';

const option = (key: string) =>
  process.argv.find((argument) => argument.startsWith(`--${key}=`))?.slice(key.length + 3);
const credentialFile = option('credential');
const receiptFile = option('receipt');
const resume = process.argv.includes('--resume-confirmed-groups');
assert(
  credentialFile && receiptFile && process.argv.includes('--confirm-real-write'),
  'Provide --credential, a NEW --receipt under artifacts, and --confirm-real-write.'
);
const receiptPath = resolve(receiptFile);
assert(
  receiptPath.startsWith(resolve('artifacts') + sep),
  'Receipts must stay in the ignored artifacts directory.'
);
assert(
  !existsSync(receiptPath) || resume,
  'Receipt already exists. Do not resend mutations; reconcile the saved resources read-only.'
);
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(credentialFile), 'utf8')) as unknown
);
assert.equal(bundle.protocol, 'iop');
assert(
  bundle.oauth.expiresAtUtc === null || Date.parse(bundle.oauth.expiresAtUtc) > Date.now() + 600_000,
  'Reauthorize before acceptance; no token refresh is performed.'
);
const credentials: GatewayCredentials = {
  protocol: 'iop',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256',
  appKey: bundle.application.appKey,
  appSecret: bundle.application.appSecret,
  accessToken: bundle.oauth.accessToken
};
const network = new NetworkManager({
  policies: {
    alibaba: {
      allowedOrigins: [new URL(IOP_BUSINESS_ENDPOINT).origin],
      maxRequestBytes: 6 * 1024 * 1024,
      timeoutMilliseconds: 30_000
    }
  }
});
const receipt: {
  schemaVersion: 1;
  capturedAtUtc: string;
  protocol: 'iop';
  configurationChanged: false;
  status: string;
  failureCode?: string;
  resources: {
    groupId?: string;
    childId?: string;
    fileId?: string;
    sourceSha256?: string;
    contentVerified?: boolean;
  };
  steps: { action: string; requestId: string; status: string; errorCode?: string; subCode?: string }[];
} = {
  schemaVersion: 1,
  capturedAtUtc: new Date().toISOString(),
  protocol: 'iop',
  configurationChanged: false,
  status: 'running',
  resources: {},
  steps: []
};
const save = () => atomicWriteJson(receiptPath, receipt);
if (resume) {
  const saved: unknown = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert(
    isRecord(saved) &&
      saved.schemaVersion === 1 &&
      saved.protocol === 'iop' &&
      saved.status === 'needs-attention'
  );
  assert(
    isRecord(saved.resources) &&
      typeof saved.resources.groupId === 'string' &&
      /^\d{1,16}$/u.test(saved.resources.groupId) &&
      typeof saved.resources.childId === 'string' &&
      /^\d{1,16}$/u.test(saved.resources.childId) &&
      saved.resources.fileId === undefined
  );
  assert(
    Array.isArray(saved.steps) &&
      saved.steps.length === 3 &&
      saved.steps.every(
        (step, index) =>
          isRecord(step) &&
          step.status === 'accepted' &&
          step.action === ['group-add', 'group-rename', 'group-add'][index]
      )
  );
  receipt.resources.groupId = saved.resources.groupId;
  receipt.resources.childId = saved.resources.childId;
  receipt.steps = saved.steps as typeof receipt.steps;
}
const readClient = {
  call: (method: string, parameters: Readonly<Record<string, unknown>>) =>
    new AlibabaClient(credentials, network, { maxAttempts: 1, requestId: crypto.randomUUID() }).call(
      method,
      parameters
    ),
  callWithFile: new AlibabaClient(credentials, network).callWithFile.bind(
    new AlibabaClient(credentials, network)
  )
};
const photos = new PhotoAdapter(readClient);
const groupMethod = 'alibaba.icbu.photobank.group.operate';
const uploadMethod = 'alibaba.icbu.photobank.upload';
const label = `ov-iop-${crypto.randomUUID().slice(0, 8)}`;

async function mutation(
  action: string,
  method: typeof groupMethod | typeof uploadMethod,
  parameters: Record<string, unknown>,
  bytes?: Uint8Array
) {
  const step = { action, requestId: crypto.randomUUID(), status: 'dispatching' };
  receipt.steps.push(step);
  await save(); // A failed local receipt must prevent the network write.
  try {
    const file = bytes
      ? await createAlibabaFileRequest(credentials, method, parameters, {
          bytes,
          fieldName: 'image_bytes',
          fileName: `${label}.png`,
          contentType: 'image/png'
        })
      : null;
    const request = file ?? (await createIopBusinessRequest(credentials, method, parameters));
    const response = await network.request({
      service: 'alibaba',
      url: request.url,
      method: 'POST',
      requestId: step.requestId,
      headers: { 'Content-Type': file?.contentType ?? 'application/x-www-form-urlencoded;charset=utf-8' },
      body: file?.body ?? new URLSearchParams('parameters' in request ? request.parameters : {}),
      responseType: 'json'
    });
    if (!response.ok) throw new Error('IOP_ACCEPTANCE_TRANSPORT_UNCERTAIN');
    const data = normalizeIopBusinessResponse(response.data, method, credentials);
    step.status = 'accepted';
    await save();
    await setTimeout(350);
    return data;
  } catch (error) {
    const normalized = normalizeGatewayError(error);
    step.status = normalized.code === 'ALIBABA_IOP_BUSINESS_REJECTED' ? 'rejected' : 'unknown';
    Object.assign(step, {
      errorCode: normalized.code,
      ...(normalized.subCode ? { subCode: normalized.subCode } : {})
    });
    await save();
    throw new Error('IOP_ACCEPTANCE_STOPPED_SEE_RECEIPT', { cause: error });
  }
}

async function group(action: 'add' | 'rename' | 'delete', name: string, id?: string) {
  const request: PhotoGroupOperationRequest = {
    operation: action,
    groupId: id ?? null,
    groupName: action === 'delete' ? null : name
  };
  const data = await mutation(`group-${action}`, groupMethod, {
    photo_group_operation_request: {
      operation: action,
      ...(id ? { group_id: id } : {}),
      ...(action === 'delete' ? {} : { group_name: name })
    }
  });
  return new PhotoAdapter({
    ...readClient,
    call: () => Promise.resolve({ method: groupMethod, data })
  }).operateGroup(request);
}
async function poll(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 15; attempt++) {
    if (await check()) return;
    await setTimeout(2_000);
  }
  throw new Error('IOP_ACCEPTANCE_READBACK_PENDING_NO_RESEND');
}

await save();
try {
  await photos.listGroups(); // Read-only credential preflight; active workbench configuration is untouched.
  const parent = resume ? { groupId: String(receipt.resources.groupId) } : await group('add', label);
  receipt.resources.groupId = parent.groupId;
  await save();
  if (!resume) {
    await poll(async () =>
      (await photos.listGroups()).some((item) => item.id === parent.groupId && item.name === label)
    );
    await group('rename', `${label}-r`, parent.groupId);
    await poll(async () =>
      (await photos.listGroups()).some((item) => item.id === parent.groupId && item.name === `${label}-r`)
    );
  }
  const child = resume
    ? { groupId: String(receipt.resources.childId) }
    : await group('add', `${label}-child`, parent.groupId);
  receipt.resources.childId = child.groupId;
  await save();
  await poll(async () =>
    (await photos.listGroups(parent.groupId)).some(
      (item) => item.id === child.groupId && item.parentId === parent.groupId
    )
  );
  const empty = await photos.list({ groupId: child.groupId, page: 1, pageSize: 1 });
  if (!process.argv.includes('--keep-created-test-child')) {
    const groups = await photos.listGroups(parent.groupId);
    const childGroups = await photos.listGroups(child.groupId);
    assert(
      confirmedEmptyPhotoChild(parent.groupId, child.groupId, groups, empty, childGroups),
      'Refuse to delete without a consistent zero total and a confirmed parent-child relationship.'
    );
    await group('delete', '', child.groupId);
    await poll(async () =>
      confirmedPhotoChildRemoved(parent.groupId, child.groupId, await photos.listGroups(parent.groupId))
    );
  }

  const bytes = new Uint8Array(await readFile('apps/extension/public/icon.png'));
  assert(bytes.length <= 5 * 1024 * 1024);
  receipt.resources.sourceSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  await save();
  const data = await mutation(
    'photo-upload',
    uploadMethod,
    { file_name: `${label}.png`, group_id: parent.groupId },
    bytes
  );
  const root = isRecord(data) ? data.alibaba_icbu_photobank_upload_response : null;
  const image = isRecord(root) ? root.upload_image_response : null;
  assert(
    isRecord(image) &&
      (typeof image.file_id === 'number' || typeof image.file_id === 'string') &&
      typeof image.photobank_url === 'string'
  );
  receipt.resources.fileId = String(image.file_id);
  await save();
  await poll(async () => {
    for (let page = 1; page <= 50; page++) {
      const result = await photos.list({ groupId: parent.groupId, page, pageSize: 100 });
      const found = result.items.find((item) => item.id === receipt.resources.fileId);
      if (found) return found.groupId === parent.groupId;
      if (!result.hasNextPage) return false;
      await setTimeout(350);
    }
    throw new Error('IOP_ACCEPTANCE_PAGINATION_INCOMPLETE');
  });
  const downloaded = await downloadProductAsset({ url: image.photobank_url });
  receipt.resources.contentVerified = downloaded.sha256 === receipt.resources.sourceSha256;
  assert(receipt.resources.contentVerified, 'Uploaded content differs; do not resend.');
  receipt.status = 'completed';
  await save();
  process.stdout.write(
    `IOP-only group add/rename/child and one image upload/readback/hash passed; deletion ${receipt.steps.some((step) => step.action === 'group-delete') ? 'verified' : 'not tested (child retained)'}. Receipt: ${receiptFile}\n`
  );
} catch (error) {
  receipt.status = 'needs-attention';
  const normalized = normalizeGatewayError(error);
  receipt.failureCode =
    error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message)
      ? error.message
      : (normalized.subCode ?? normalized.code);
  await save();
  process.stderr.write(
    `Acceptance stopped without retrying writes. Inspect sanitized receipt: ${receiptFile}\n`
  );
  process.exitCode = 1;
}
