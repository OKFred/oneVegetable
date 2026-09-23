import type { VideoUploadCommand, VideoUploadTask } from '../../packages/core/src/video-upload';

export const PUBLIC_VIDEO_ENDPOINT = 'https://oss-s3.this-time.com';
export const PRIVATE_VIDEO_ENDPOINT = 'https://oss-s3.app.fred.wiki';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const actions = [
  'preflight',
  'ui-read',
  'prepare',
  'inspect',
  'stage',
  'submit',
  'verify',
  'reconcile'
] as const;
export type Action = (typeof actions)[number];
export interface SmokeOptions {
  action: Action;
  runId: string | null;
  taskId: string | null;
  file: string | null;
  resume: boolean;
  restart: boolean;
  stopAfterParts: number | null;
}

/** Only our own fixed codes reach stdout/reports; provider/Playwright errors never do. */
export class SmokeError extends Error {}
export function stop(code: string): never {
  throw new SmokeError(code);
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseOptions(args: string[], env: NodeJS.ProcessEnv): SmokeOptions {
  const flags = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.+))?$/u.exec(arg);
    if (!match?.[1] || flags.has(match[1])) stop('INVALID_OPTIONS');
    flags.set(match[1], match[2] ?? '');
  }
  for (const [name, value] of flags) {
    if (['run', 'task', 'file', 'stop-after-parts'].includes(name)) {
      if (!value) stop('INVALID_OPTIONS');
    } else if (![...actions, 'resume', 'restart'].some((item) => item === name) || value) {
      stop('INVALID_OPTIONS');
    }
  }
  const selected = actions.filter((action) => flags.has(action));
  if (selected.length > 1) stop('INVALID_OPTIONS');
  const action = selected[0] ?? 'preflight';
  const runId = flags.get('run') ?? null;
  const taskId = flags.get('task') ?? null;
  const file = flags.get('file') ?? null;
  const resume = flags.has('resume'),
    restart = flags.has('restart');
  const limit = flags.get('stop-after-parts');
  const stopAfterParts = limit === undefined ? null : Number(limit);
  if (action === 'preflight') {
    if ([...flags.keys()].some((name) => name !== 'preflight')) stop('EXPLICIT_ACTION_REQUIRED');
  } else {
    if (!runId || !uuid.test(runId)) stop('RUN_UUID_REQUIRED');
    if (env.ONE_VEGETABLE_EXTENSION_VIDEO_UPLOAD_REAL_SMOKE !== '1') stop('LIVE_OPT_IN_REQUIRED');
  }
  const needsTask = ['inspect', 'stage', 'submit', 'verify', 'reconcile'].includes(action);
  if (needsTask ? !taskId || !uuid.test(taskId) : taskId !== null) stop('EXACT_TASK_REQUIRED');
  if (['prepare', 'stage'].includes(action) ? !file : file !== null) stop('FILE_OPTION_INVALID');
  if (resume && action !== 'stage') stop('RESUME_REQUIRES_STAGE');
  if (restart && !['ui-read', 'inspect', 'verify', 'reconcile'].includes(action)) stop('RESTART_READ_ONLY');
  if (limit !== undefined && (action !== 'stage' || !/^[1-9]\d?$/u.test(limit) || Number(limit) > 10))
    stop('PART_LIMIT_INVALID');
  if (['stage', 'submit'].includes(action) && env.ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE !== '1')
    stop('WRITE_OPT_IN_REQUIRED');
  return { action, runId, taskId, file, resume, restart, stopAfterParts };
}

export function assertStorage(value: unknown, submit = false): void {
  if (
    !record(value) ||
    ![PUBLIC_VIDEO_ENDPOINT, PRIVATE_VIDEO_ENDPOINT].includes(String(value.endpoint)) ||
    value.bucket !== 'dev' ||
    value.pathStyle !== true ||
    value.rootPrefix !== '' ||
    value.allowInsecureLocal === true
  )
    stop('EXACT_STORAGE_REQUIRED');
  if (submit && value.endpoint !== PUBLIC_VIDEO_ENDPOINT) stop('PUBLIC_ENDPOINT_REQUIRED_NO_SUBSTITUTION');
}

/** Defense in depth: an action can never accidentally dispatch another mode's command. */
export function assertCommandAllowed(options: SmokeOptions, command: VideoUploadCommand): void {
  const extra: Partial<Record<Action, readonly VideoUploadCommand['action'][]>> = {
    prepare: ['create'],
    stage: ['initiate', 'part', 'complete'],
    submit: ['submit'],
    verify: ['verify'],
    reconcile: ['reconcile']
  };
  if (
    options.action === 'preflight' ||
    (!['list', 'get'].includes(command.action) && !extra[options.action]?.includes(command.action))
  )
    stop('COMMAND_OUTSIDE_EXPLICIT_ACTION');
  if ('taskId' in command && command.taskId !== options.taskId) stop('TASK_IDENTITY_MISMATCH');
}

export interface Attempt {
  requestId: string;
  action: VideoUploadCommand['action'];
  outcome: 'intent' | 'response' | 'error' | 'reconciled';
  partNumber: number | null;
}
export interface Journal {
  schemaVersion: 1;
  runId: string;
  taskId: string | null;
  attempts: Attempt[];
}
const commands: readonly string[] = [
  'list',
  'get',
  'create',
  'initiate',
  'part',
  'complete',
  'submit',
  'verify',
  'reconcile'
];
export function readJournal(value: unknown, runId: string): Journal {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.runId !== runId ||
    !(value.taskId === null || (typeof value.taskId === 'string' && uuid.test(value.taskId))) ||
    !Array.isArray(value.attempts) ||
    value.attempts.length > 1000
  )
    stop('JOURNAL_INVALID');
  const attempts: Attempt[] = value.attempts.map((item: unknown) => {
    if (
      !record(item) ||
      typeof item.requestId !== 'string' ||
      !uuid.test(item.requestId) ||
      typeof item.action !== 'string' ||
      !commands.includes(item.action) ||
      !['intent', 'response', 'error', 'reconciled'].includes(String(item.outcome)) ||
      !(
        item.partNumber === null ||
        (typeof item.partNumber === 'number' &&
          Number.isSafeInteger(item.partNumber) &&
          item.partNumber >= 1 &&
          item.partNumber <= 10)
      )
    )
      stop('JOURNAL_INVALID');
    return {
      requestId: item.requestId,
      action: item.action as Attempt['action'],
      outcome: item.outcome as Attempt['outcome'],
      partNumber: item.partNumber
    };
  });
  // Reconstruct, never spread an on-disk object into the next report.
  return { schemaVersion: 1, runId, taskId: value.taskId, attempts };
}

export function assertTaskIdentity(task: VideoUploadTask, journal: Journal, taskId: string): void {
  if (
    journal.taskId !== taskId ||
    task.id !== taskId ||
    task.source !== 'file' ||
    !task.file ||
    task.objectKey !== `onevegetable/video-staging/${taskId}/source.mp4`
  )
    stop('TASK_IDENTITY_MISMATCH');
}
export function assertCanPrepare(journal: Journal): void {
  if (journal.taskId || journal.attempts.some((item) => item.action === 'create'))
    stop('CREATE_ALREADY_ATTEMPTED');
}
export function assertCanStage(task: VideoUploadTask, journal: Journal, resume: boolean): void {
  if (journal.attempts.some((item) => item.action === 'submit')) stop('SUBMIT_ALREADY_ATTEMPTED');
  if (
    !['prepared', 'staging', 'staged'].includes(task.status) ||
    task.reasonCode ||
    task.parts.some((part) => !['pending', 'confirmed'].includes(part.status))
  )
    stop('READ_ONLY_RECONCILIATION_REQUIRED');
  if (task.status === 'staged') return;
  if (task.status === 'staging' && !resume) stop('EXPLICIT_RESUME_REQUIRED');
  if (
    journal.attempts.some(
      (item) =>
        ['initiate', 'part', 'complete'].includes(item.action) &&
        !['response', 'reconciled'].includes(item.outcome)
    )
  )
    stop('UNCERTAIN_WRITE_NO_RETRY');
}
export function assertCanSubmit(task: VideoUploadTask, journal: Journal): void {
  if (journal.attempts.some((item) => item.action === 'submit')) stop('SUBMIT_ALREADY_ATTEMPTED');
  if (task.status !== 'staged' || task.reasonCode || task.parts.some((part) => part.status !== 'confirmed'))
    stop('STAGED_TASK_REQUIRED');
}

/** Explicit ListParts reconciliation may resolve a part only. Never retry initiate/complete/submit. */
export function recordReconciliation(journal: Journal, task: VideoUploadTask): void {
  for (const attempt of journal.attempts) {
    if (attempt.action !== 'part' || !['intent', 'error'].includes(attempt.outcome)) continue;
    const part = task.parts.find((part) => part.partNumber === attempt.partNumber);
    if (task.status === 'staging' && part && ['pending', 'confirmed'].includes(part.status))
      attempt.outcome = 'reconciled';
  }
}

export function taskEvidence(task: VideoUploadTask) {
  return {
    id: task.id,
    revision: task.revision,
    status: task.status,
    byteLength: task.file?.byteLength ?? null,
    sha256: task.file?.sha256 ?? null,
    hasVideoId: task.videoId !== null,
    hasTraceId: task.traceId !== null,
    parts: task.parts.map((part) => ({
      partNumber: part.partNumber,
      byteLength: part.byteLength,
      status: part.status
    }))
  };
}
