/** Local BFF only. Default preflight; writes require --stage/--submit/--abort and explicit opt-in.
 * Never imports/replaces credentials or storage configuration; use the existing local workbench.
 * --stage [--resume] --file=<mp4> [--task=<uuid>]; --submit/--verify/--reconcile/--abort --task=<uuid>.
 * --generate is an optional synthetic MP4 source for --stage when ffmpeg is installed.
 * No automatic retries, completed-object deletion, credential output or signed-URL persistence.
 */
import { execFileSync } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { NetworkManager } from '../packages/core/src/network';
import { encodeBase64 } from '../packages/core/src/encoded-file';
import { normalizeApiPrefix } from '../packages/core/src/api-contract';
import { requireGalleryContext } from '../packages/core/src/gallery-transfer-context';
import {
  fingerprintVideoFile,
  validateVideoUploadResult,
  verifyReselectedVideo,
  VIDEO_UPLOAD_PART_BYTES,
  type VideoUploadCommand,
  type VideoUploadResult,
  type VideoUploadTask
} from '../packages/core/src/video-upload';
import { atomicWriteJson } from './openapi-auth/storage';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const actions = ['--stage', '--submit', '--verify', '--reconcile', '--abort'];
const action = args.find((arg) => actions.includes(arg)) ?? '--preflight';
if (
  args.filter((arg) => actions.includes(arg)).length > 1 ||
  (args.includes('--preflight') && args.some((arg) => actions.includes(arg))) ||
  (args.includes('--resume') && (!args.some((arg) => arg.startsWith('--task=')) || action !== '--stage')) ||
  args.some(
    (arg) =>
      !actions.includes(arg) &&
      !['--preflight', '--resume', '--generate'].includes(arg) &&
      !/^--(?:file|task)=/u.test(arg)
  )
)
  throw new Error('INVALID_SMOKE_OPTIONS');
if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
const write = ['--stage', '--submit', '--abort'].includes(action);
if (write && process.env.ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE !== '1')
  throw new Error('VIDEO_WRITE_OPT_IN_REQUIRED');
const base = new URL(process.env.VIDEO_SMOKE_BFF_URL ?? 'http://localhost:8787');
if (
  !['localhost', '127.0.0.1'].includes(base.hostname) ||
  base.protocol !== 'http:' ||
  base.pathname !== '/' ||
  base.search ||
  base.hash ||
  base.username ||
  base.password
)
  throw new Error('LOCAL_BFF_REQUIRED');
const prefix = normalizeApiPrefix(process.env.ONE_VEGETABLE_API_PREFIX);
const origin = new URL(process.env.VIDEO_SMOKE_WEB_ORIGIN ?? 'http://localhost:5173').origin;
const directory = resolve(root, 'artifacts/video-upload-validation');
execFileSync('git', ['check-ignore', '--quiet', '--', relative(root, directory)], {
  cwd: root,
  stdio: 'pipe'
});
const runId = crypto.randomUUID();
const output = resolve(directory, `${runId}.json`);
const report: {
  runId: string;
  action: string;
  status: string;
  task: VideoUploadTask | null;
  requests: { requestId: string; phase: string; status: string; storageError?: string }[];
  reason: string | null;
  failureType?: string;
  failureSites?: string[];
} = { runId, action, status: 'preflight', task: null, requests: [], reason: null };
const persist = () => atomicWriteJson(output, report);
const authPath = resolve(
  root,
  process.env.VIDEO_SMOKE_LOGIN_FILE ?? 'artifacts/gallery-transfer-2.6/local/local-auth.json'
);
execFileSync('git', ['check-ignore', '--quiet', '--', relative(root, authPath)], {
  cwd: root,
  stdio: 'pipe'
});
const auth: unknown = JSON.parse(await readFile(authPath, 'utf8'));
if (!record(auth) || typeof auth.username !== 'string' || typeof auth.password !== 'string')
  throw new Error('LOCAL_AUTH_UNAVAILABLE');
const network = new NetworkManager({
  policies: {
    bff: {
      allowedOrigins: [base.origin],
      timeoutMilliseconds: 360_000,
      maxRequestBytes: 7 * 1024 * 1024,
      maxResponseBytes: 2 * 1024 * 1024,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store'
    }
  }
});
let cookie = '';
let csrf = '';
async function call(path: string, payload: Record<string, unknown>, phase = path): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const entry: (typeof report.requests)[number] = { requestId, phase, status: 'intent' };
  report.requests.push(entry);
  await persist();
  const response = await network.request({
    service: 'bff',
    url: `${base.origin}${prefix}${path}`,
    requestId,
    method: 'POST',
    maxAttempts: 1,
    responseType: 'json',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {})
    },
    body: JSON.stringify({ requestId, ...payload })
  });
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .filter((value): value is string => Boolean(value) && /^ov_(?:session|csrf)=/u.test(value ?? ''));
  if (cookies.length) cookie = cookies.join('; ');
  const value = response.data;
  if (!record(value) || value.requestId !== requestId) throw new Error('RESPONSE_CORRELATION_INVALID');
  entry.status = value.ok === true ? 'response-success' : 'response-error';
  if (
    record(value.error) &&
    value.error.code === 'S3_REQUEST_FAILED' &&
    typeof value.error.subCode === 'string' &&
    /^HTTP_\d{3}:[A-Za-z]{1,50}$/u.test(value.error.subCode)
  )
    entry.storageError = value.error.subCode;
  await persist();
  if (value.ok !== true || !('data' in value)) {
    const code =
      record(value.error) &&
      typeof value.error.code === 'string' &&
      /^[A-Z0-9_]{1,100}$/u.test(value.error.code)
        ? value.error.code
        : 'VIDEO_SMOKE_REQUEST_FAILED';
    throw new Error(code);
  }
  return value.data;
}
try {
  const login = await call('/auth/login', { username: auth.username, password: auth.password }, 'login');
  if (!record(login) || !record(login.session) || typeof login.session.csrfToken !== 'string')
    throw new Error('LOGIN_RESPONSE_INVALID');
  csrf = login.session.csrfToken;
  const meta = await call('/meta/get', {});
  if (
    !record(meta) ||
    meta.runtime !== 'node' ||
    meta.environment !== 'local-node' ||
    meta.gatewayMode !== 'real'
  )
    throw new Error('LOCAL_REAL_BFF_REQUIRED');
  const storage = await call('/admin/storage/s3/get', {});
  if (
    !record(storage) ||
    !['https://oss-s3.this-time.com', 'https://oss-s3.app.fred.wiki'].includes(String(storage.endpoint)) ||
    storage.bucket !== 'dev' ||
    storage.rootPrefix !== ''
  )
    throw new Error('EXACT_VIDEO_TEST_STORAGE_REQUIRED');
  if (action === '--submit' && storage.endpoint !== 'https://oss-s3.this-time.com')
    throw new Error('PUBLIC_ENDPOINT_REQUIRED_NO_HOST_SUBSTITUTION');
  const context = requireGalleryContext(await call('/gallery-transfers/context/get', {}));
  const control = async (command: VideoUploadCommand): Promise<VideoUploadResult> => {
    const result = await call('/video-uploads/call', { command, context }, `video.${command.action}`);
    if (!validateVideoUploadResult(result)) throw new Error('VIDEO_RESPONSE_INVALID');
    return result as VideoUploadResult;
  };
  const known = await control({ action: 'list' });
  if (write && !known.uploadEnabled) throw new Error('LOCAL_VIDEO_METHOD_FLAG_REQUIRED');
  let taskId = args.find((arg) => arg.startsWith('--task='))?.slice(7);
  if (taskId && !/^[0-9a-f-]{36}$/u.test(taskId)) throw new Error('INVALID_TASK_ID');
  let task = taskId ? (await control({ action: 'get', taskId })).tasks[0] : undefined;
  async function execute(command: VideoUploadCommand): Promise<void> {
    const result = await control(command);
    task = result.tasks[0];
    if (!task) throw new Error('TASK_NOT_RETURNED');
    report.task = task;
    report.status = task.status;
    await persist();
  }
  function target(): { taskId: string; revision: number } {
    if (!task) throw new Error('TASK_REQUIRED');
    return { taskId: task.id, revision: task.revision };
  }
  if (action === '--stage') {
    if (task && !args.includes('--resume')) throw new Error('MANUAL_RESUME_REQUIRED');
    let filePath = args.find((arg) => arg.startsWith('--file='))?.slice(7);
    if (!filePath && args.includes('--generate')) {
      await mkdir(resolve(directory, runId), { recursive: true });
      filePath = resolve(directory, runId, 'synthetic-video.mp4');
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-n',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=720x720:rate=24',
          '-t',
          '5',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-b:v',
          '12M',
          '-minrate',
          '12M',
          '-maxrate',
          '12M',
          '-bufsize',
          '24M',
          '-x264-params',
          'nal-hrd=cbr:force-cfr=1',
          '-an',
          '-movflags',
          '+faststart',
          filePath
        ],
        { windowsHide: true, stdio: 'ignore' }
      );
    }
    if (!filePath) throw new Error('MP4_SOURCE_REQUIRED');
    const file = new File(
      [await openAsBlob(resolve(root, filePath), { type: 'video/mp4' })],
      basename(filePath),
      { type: 'video/mp4' }
    );
    const fingerprint = task ? await verifyReselectedVideo(file, task) : await fingerprintVideoFile(file);
    if (!task)
      await execute({
        action: 'create',
        title: 'oneVegetable video upload smoke',
        source: { kind: 'file', file: fingerprint }
      });
    if (!task) throw new Error('TASK_REQUIRED');
    taskId = task.id;
    if (task.status === 'prepared') await execute({ action: 'initiate', ...target() });
    if (
      task.parts.some((part) => ['unknown', 'in-flight'].includes(part.status)) ||
      task.status === 'needs-review'
    )
      throw new Error('MANUAL_RECONCILIATION_REQUIRED');
    for (const part of task.parts.filter((item) => item.status === 'pending')) {
      const start = (part.partNumber - 1) * VIDEO_UPLOAD_PART_BYTES;
      const bytes = new Uint8Array(await file.slice(start, start + part.byteLength).arrayBuffer());
      await execute({
        action: 'part',
        ...target(),
        partNumber: part.partNumber,
        contentBase64: encodeBase64(bytes),
        fileSha256: fingerprint.sha256
      });
    }
    if (task.status !== 'staged') await execute({ action: 'complete', ...target() });
  } else if (action === '--submit') {
    await execute({ action: 'submit', ...target(), confirmed: true });
  } else if (action === '--reconcile') {
    await execute({ action: 'reconcile', ...target() });
  } else if (action === '--abort') {
    await execute({ action: 'cancel', ...target() });
  }
  if (action === '--submit' || action === '--verify') {
    const until = Date.now() + 300_000;
    do {
      await execute({ action: 'verify', ...target() });
      if (task?.status === 'confirmed' || task?.status === 'needs-review') break;
      await wait(15_000);
    } while (Date.now() < until);
    if (task?.status !== 'confirmed') {
      report.reason = 'VIDEO_PENDING_READBACK_NOT_UPLOADED';
      process.exitCode = 2;
    }
  }
  if (action === '--preflight') report.status = 'preflight-passed-no-upload';
  report.task = task ?? null;
  await persist();
  process.stdout.write(`Video smoke: ${report.status}; redacted report: ${relative(root, output)}\n`);
} catch (error) {
  report.status = 'stopped-no-automatic-retry';
  if (error instanceof Error) {
    report.failureType = /^[A-Za-z]{1,50}$/u.test(error.name) ? error.name : 'Error';
    report.failureSites =
      error.stack?.match(
        /(?:smoke-video-upload-task-real|encoded-file|video-upload|storage)\.ts:\d+:\d+/gu
      ) ?? [];
  }
  report.reason =
    error instanceof Error && /^[A-Z0-9_]{1,100}$/u.test(error.message)
      ? error.message
      : 'VIDEO_SMOKE_FAILED';
  await persist();
  process.stderr.write(`Video smoke stopped: ${report.reason}; report: ${relative(root, output)}\n`);
  process.exitCode = 1;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
