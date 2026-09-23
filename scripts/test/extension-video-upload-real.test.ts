import { describe, expect, it } from 'vitest';
import type { VideoUploadCommand, VideoUploadTask } from '../../packages/core/src/video-upload';
import {
  assertCanPrepare,
  assertCanStage,
  assertCanSubmit,
  assertCommandAllowed,
  assertStorage,
  assertTaskIdentity,
  parseOptions,
  PRIVATE_VIDEO_ENDPOINT,
  PUBLIC_VIDEO_ENDPOINT,
  readJournal,
  recordReconciliation,
  taskEvidence,
  type Journal
} from '../lib/extension-video-upload-real';

const runId = '12345678-1234-4234-8234-123456789012';
const taskId = 'abcdef12-1234-4234-8234-123456789012';
const live = { ONE_VEGETABLE_EXTENSION_VIDEO_UPLOAD_REAL_SMOKE: '1' };
const write = { ...live, ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE: '1' };
const run = `--run=${runId}`,
  target = `--task=${taskId}`;
const file = '--file=artifacts/video.mp4';
function journal(): Journal {
  return { schemaVersion: 1, runId, taskId, attempts: [] };
}
function task(status: VideoUploadTask['status'] = 'prepared'): VideoUploadTask {
  return {
    schemaVersion: 1,
    id: taskId,
    revision: 1,
    context: { identity: 'a'.repeat(64), gateway: 'b'.repeat(64), storage: 'c'.repeat(64) },
    title: 'private-title',
    source: 'file',
    file: { fileName: 'private-name.mp4', byteLength: 16, sha256: 'd'.repeat(64) },
    sourceFingerprint: 'd'.repeat(64),
    objectKey: `onevegetable/video-staging/${taskId}/source.mp4`,
    parts: [{ partNumber: 1, byteLength: 16, status: 'pending', requestId: null, sha256: null, etag: null }],
    status,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    acceptedTimeUtc: null,
    videoId: null,
    traceId: null,
    reasonCode: null,
    requestId: runId
  };
}
function firstPart(value: VideoUploadTask) {
  const part = value.parts[0];
  if (!part) throw new Error('TEST_PART_MISSING');
  return part;
}

describe('extension real video smoke opt-in boundary', () => {
  it('defaults to local preflight even with BOTH write opt-ins present', () => {
    expect(parseOptions([], write)).toMatchObject({ action: 'preflight', taskId: null, runId: null });
    expect(parseOptions(['--preflight'], {})).toMatchObject({ action: 'preflight' });
  });
  it('keeps UI read independent of S3, file, task and write flags', () => {
    expect(parseOptions(['--ui-read', run, '--restart'], live)).toMatchObject({
      action: 'ui-read',
      restart: true
    });
    expect(() => parseOptions(['--ui-read', run], {})).toThrow('LIVE_OPT_IN_REQUIRED');
  });
  it('requires a local preparation action before a task can be staged', () => {
    expect(parseOptions(['--prepare', run, file], live).action).toBe('prepare');
    expect(() => parseOptions(['--prepare', run, file, target], write)).toThrow('EXACT_TASK_REQUIRED');
    expect(() => parseOptions(['--stage', run, file], write)).toThrow('EXACT_TASK_REQUIRED');
    expect(() => parseOptions(['--stage', run, file, target], live)).toThrow('WRITE_OPT_IN_REQUIRED');
    expect(
      parseOptions(['--stage', run, file, target, '--resume', '--stop-after-parts=1'], write)
    ).toMatchObject({ resume: true, stopAfterParts: 1 });
    expect(parseOptions(['--submit', run, target], write).action).toBe('submit');
    expect(() => parseOptions(['--submit', run, target], live)).toThrow('WRITE_OPT_IN_REQUIRED');
  });
  it.each([
    ['--stage', '--submit', run, target, file],
    ['--ui-read', '--ui-read', run],
    ['--ui-read', run, '--run=other'],
    ['--ui-read=1', run],
    ['--ui-read', '--run=../profile'],
    ['--preflight', run],
    [run, target, file],
    ['--submit', run, target, '--resume'],
    ['--stage', run, target, file, '--restart'],
    ['--prepare', run, file, '--restart'],
    ['--submit', run, target, file],
    ['--ui-read', run, '--endpoint=https://example.com'],
    ['--stage', run, target, file, '--stop-after-parts=0'],
    ['--stage', run, target, file, '--stop-after-parts=11'],
    ['--stage', run, target, file, '--stop-after-parts=1.1'],
    ['--stage', run, target, file, '--stop-after-parts=1e0'],
    ['--abort', run, target],
    ['--enable-upload', run],
    ['--pregrant', run],
    ['--generate', run]
  ])('rejects ambiguous or out-of-scope options: %j', (...args) => {
    expect(() => parseOptions(args, write)).toThrow();
  });
  it.each(['inspect', 'verify', 'reconcile'])('allows %s without the remote-write opt-in', (action) => {
    expect(parseOptions([`--${action}`, run, target, '--restart'], live).action).toBe(action);
  });
  it('dispatches only commands authorized by the current action, never submit during stage', () => {
    const submit: VideoUploadCommand = { action: 'submit', taskId, revision: 1, confirmed: true };
    for (const action of ['ui-read', 'prepare', 'inspect', 'stage', 'verify', 'reconcile'] as const) {
      const options = {
        action,
        runId,
        taskId,
        file: null,
        resume: false,
        restart: false,
        stopAfterParts: null
      };
      expect(() => {
        assertCommandAllowed(options, submit);
      }).toThrow('COMMAND_OUTSIDE_EXPLICIT_ACTION');
    }
    const options = parseOptions(['--submit', run, target], write);
    expect(() => {
      assertCommandAllowed(options, submit);
    }).not.toThrow();
    expect(() => {
      assertCommandAllowed(options, { ...submit, taskId: runId });
    }).toThrow('TASK_IDENTITY_MISMATCH');
    expect(() => {
      assertCommandAllowed(parseOptions([], write), { action: 'list' });
    }).toThrow();
    const stage = parseOptions(['--stage', run, target, file], write);
    expect(() => {
      assertCommandAllowed(stage, { action: 'cancel', taskId, revision: 1 });
    }).toThrow();
  });
});

describe('storage and recovery boundaries', () => {
  const storage = { endpoint: PUBLIC_VIDEO_ENDPOINT, bucket: 'dev', rootPrefix: '', pathStyle: true };
  it('only accepts exact approved path-style dev origins, and public submit', () => {
    expect(() => {
      assertStorage(storage, true);
    }).not.toThrow();
    expect(() => {
      assertStorage({ ...storage, endpoint: PRIVATE_VIDEO_ENDPOINT });
    }).not.toThrow();
    expect(() => {
      assertStorage({ ...storage, endpoint: PRIVATE_VIDEO_ENDPOINT }, true);
    }).toThrow('PUBLIC_ENDPOINT_REQUIRED_NO_SUBSTITUTION');
    for (const endpoint of [
      'http://oss-s3.this-time.com',
      `${PUBLIC_VIDEO_ENDPOINT}/`,
      `${PUBLIC_VIDEO_ENDPOINT}:443`,
      `${PUBLIC_VIDEO_ENDPOINT}/dev`,
      `${PUBLIC_VIDEO_ENDPOINT}?x=1`,
      'https://dev.oss-s3.this-time.com'
    ])
      expect(() => {
        assertStorage({ ...storage, endpoint });
      }).toThrow('EXACT_STORAGE_REQUIRED');
    for (const change of [
      { bucket: 'prod' },
      { rootPrefix: 'other/' },
      { pathStyle: false },
      { allowInsecureLocal: true }
    ])
      expect(() => {
        assertStorage({ ...storage, ...change });
      }).toThrow('EXACT_STORAGE_REQUIRED');
  });
  it('pins exact run and task identity; never prepares twice after a lost response', () => {
    expect(() => {
      assertTaskIdentity(task(), journal(), taskId);
    }).not.toThrow();
    expect(() => {
      assertTaskIdentity(task(), journal(), runId);
    }).toThrow('TASK_IDENTITY_MISMATCH');
    expect(() => {
      assertTaskIdentity({ ...task(), objectKey: 'other' }, journal(), taskId);
    }).toThrow();
    const state = { ...journal(), taskId: null };
    expect(() => {
      assertCanPrepare(state);
    }).not.toThrow();
    state.attempts.push({ requestId: runId, action: 'create', outcome: 'intent', partNumber: null });
    expect(() => {
      assertCanPrepare(state);
    }).toThrow('CREATE_ALREADY_ATTEMPTED');
  });
  it('requires manual resume and refuses every uncertain part state', () => {
    expect(() => {
      assertCanStage(task('staging'), journal(), false);
    }).toThrow('EXPLICIT_RESUME_REQUIRED');
    expect(() => {
      assertCanStage(task('staging'), journal(), true);
    }).not.toThrow();
    for (const status of ['unknown', 'in-flight'] as const) {
      const value = task('staging');
      firstPart(value).status = status;
      expect(() => {
        assertCanStage(value, journal(), true);
      }).toThrow('READ_ONLY_RECONCILIATION_REQUIRED');
    }
    for (const status of [
      'needs-review',
      'submitting',
      'accepted',
      'confirmed',
      'cancelled',
      'failed'
    ] as const)
      expect(() => {
        assertCanStage(task(status), journal(), true);
      }).toThrow();
  });
  it('lost part intents block replay until an explicit authoritative reconciliation', () => {
    const state = journal();
    state.attempts.push({ requestId: runId, action: 'part', outcome: 'intent', partNumber: 1 });
    const value = task('staging');
    expect(() => {
      assertCanStage(value, state, true);
    }).toThrow('UNCERTAIN_WRITE_NO_RETRY');
    recordReconciliation(state, value);
    expect(state.attempts[0]?.outcome).toBe('reconciled');
    expect(() => {
      assertCanStage(value, state, true);
    }).not.toThrow();
  });
  it.each(['initiate', 'complete', 'submit'] as const)('never turns uncertain %s into a retry', (action) => {
    const state = journal();
    state.attempts.push({ requestId: runId, action, outcome: 'error', partNumber: null });
    recordReconciliation(state, task('staging'));
    expect(state.attempts[0]?.outcome).toBe('error');
    expect(() => {
      assertCanStage(task('staging'), state, true);
    }).toThrow();
  });
  it('never resubmits even when the task appears staged after a lost response', () => {
    const value = task('staged');
    firstPart(value).status = 'confirmed';
    expect(() => {
      assertCanSubmit(value, journal());
    }).not.toThrow();
    const state = journal();
    state.attempts.push({ requestId: runId, action: 'submit', outcome: 'intent', partNumber: null });
    expect(() => {
      assertCanSubmit(value, state);
    }).toThrow('SUBMIT_ALREADY_ATTEMPTED');
    expect(() => {
      assertCanStage(value, state, true);
    }).toThrow('SUBMIT_ALREADY_ATTEMPTED');
  });
});

describe('secret-free evidence', () => {
  it('drops all provider strings, credentials, filenames, titles, URLs and ETags', () => {
    const value = task();
    value.traceId = 'secret-provider-response';
    value.videoId = 'private-video-id';
    value.reasonCode = 'secret-provider-code';
    firstPart(value).etag = 'secret-etag';
    const enriched = { ...value, accessToken: 'secret-token' };
    const output = JSON.stringify(taskEvidence(enriched));
    expect(output).not.toMatch(/secret|private|etag|title|objectKey|reasonCode|context/u);
    expect(JSON.parse(output)).toMatchObject({ id: taskId, hasTraceId: true, hasVideoId: true });
  });
  it('reconstructs journals and rejects corrupt or mismatched identities without echoing input', () => {
    expect(readJournal({ ...journal(), signedUrl: 'secret-url', accessToken: 'secret' }, runId)).toEqual(
      journal()
    );
    expect(() => readJournal(journal(), taskId)).toThrow('JOURNAL_INVALID');
    expect(() => readJournal({ ...journal(), taskId: '../file' }, runId)).toThrow('JOURNAL_INVALID');
    expect(() =>
      readJournal(
        {
          ...journal(),
          attempts: [{ requestId: runId, action: 'delete', outcome: 'response', partNumber: null }]
        },
        runId
      )
    ).toThrow('JOURNAL_INVALID');
  });
});
