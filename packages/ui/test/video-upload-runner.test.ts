import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeBase64 } from '@one-vegetable/core';
import {
  fingerprintVideoFile,
  VIDEO_UPLOAD_PART_BYTES,
  type VideoUploadControl,
  type VideoUploadTask
} from '@one-vegetable/core/video-upload';
import fixture from '../../../mock/data/video/upload.json';
import taskFixture from '../../../mock/data/video/upload-task.json';
import { VideoUploadRunner } from '../src/lib/video-upload-runner';

async function setup(size = 24) {
  const bytes = new Uint8Array(size);
  bytes.set(decodeBase64(fixture.mp4Base64));
  const file = new File([bytes], 'test.mp4', { type: 'video/mp4' });
  const fileInfo = await fingerprintVideoFile(file);
  let task: VideoUploadTask = {
    ...taskFixture,
    schemaVersion: 1,
    source: 'file',
    status: 'prepared',
    file: fileInfo,
    sourceFingerprint: fileInfo.sha256,
    parts: Array.from({ length: Math.ceil(size / VIDEO_UPLOAD_PART_BYTES) }, (_, i) => ({
      partNumber: i + 1,
      byteLength: Math.min(VIDEO_UPLOAD_PART_BYTES, size - i * VIDEO_UPLOAD_PART_BYTES),
      sha256: null,
      etag: null,
      status: 'pending',
      requestId: null
    }))
  };
  const call = vi.fn<VideoUploadControl['videoUpload']>().mockImplementation((command) => {
    if ('revision' in command) expect(command.revision).toBe(task.revision);
    task = { ...task, revision: task.revision + 1 };
    if (command.action === 'initiate' || command.action === 'reconcile') task.status = 'staging';
    if (command.action === 'part') {
      task.parts = task.parts.map((p) =>
        p.partNumber === command.partNumber ? { ...p, status: 'confirmed', etag: 'fixture-etag' } : p
      );
    }
    if (command.action === 'complete') task.status = 'staged';
    if (command.action === 'verify') task.status = 'confirmed';
    return Promise.resolve({ tasks: [structuredClone(task)], uploadEnabled: true });
  });
  const getContext = vi.fn().mockResolvedValue(fixture.context);
  const receipt = vi.fn();
  const runner = new VideoUploadRunner({ videoUpload: call }, fixture.context, getContext, receipt);
  return {
    file,
    get task() {
      return structuredClone(task);
    },
    setTask: (next: VideoUploadTask) => {
      task = next;
    },
    call,
    getContext,
    receipt,
    runner
  };
}

describe('foreground video staging runner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('bounds every part to 5 MiB, advances revisions and stops at staged without submitting', async () => {
    const s = await setup(VIDEO_UPLOAD_PART_BYTES + 24);
    expect((await s.runner.stage(s.task, s.file)).status).toBe('staged');
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual([
      'initiate',
      'part',
      'part',
      'complete'
    ]);
    const parts = s.call.mock.calls.flatMap(([command]) => (command.action === 'part' ? [command] : []));
    expect(parts.map((part) => decodeBase64(part.contentBase64).length)).toEqual([
      VIDEO_UPLOAD_PART_BYTES,
      24
    ]);
    expect(new Set(s.call.mock.calls.map(([, , id]) => id)).size).toBe(4);
  });
  it('stops after an in-flight receipt without sending the next part', async () => {
    const s = await setup(VIDEO_UPLOAD_PART_BYTES + 24);
    s.receipt.mockImplementation((result: { tasks: VideoUploadTask[] }) => {
      if (result.tasks[0]?.parts.some((part) => part.status === 'confirmed')) s.runner.stop();
    });
    await expect(s.runner.stage(s.task, s.file)).rejects.toMatchObject({ code: 'VIDEO_UPLOAD_PAUSED' });
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['initiate', 'part']);
    expect(s.receipt).toHaveBeenCalledTimes(2);
  });
  it('never retries an uncertain part or blindly resumes a needs-review task', async () => {
    const s = await setup();
    const implementation = s.call.getMockImplementation();
    s.call.mockImplementation((command, context, id) => {
      if (command.action === 'part') return Promise.reject(new Error('network interrupted'));
      if (!implementation) throw new Error('Missing mock implementation');
      return implementation(command, context, id);
    });
    await expect(s.runner.stage(s.task, s.file)).rejects.toThrow('network interrupted');
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['initiate', 'part']);
    s.call.mockClear();
    await expect(s.runner.stage({ ...s.task, status: 'needs-review' }, s.file)).rejects.toMatchObject({
      code: 'VIDEO_RECONCILIATION_REQUIRED'
    });
    expect(s.call).not.toHaveBeenCalled();
  });
  it('checks the original fingerprint and account before each outbound command', async () => {
    const s = await setup();
    await expect(
      s.runner.stage(
        s.task,
        new File([new Uint8Array(decodeBase64(fixture.mp4Base64)), new Uint8Array([1])], 'changed.mp4', {
          type: 'video/mp4'
        })
      )
    ).rejects.toMatchObject({ code: 'VIDEO_FILE_CHANGED' });
    expect(s.call).not.toHaveBeenCalled();
    s.getContext.mockResolvedValue({ ...fixture.context, identity: 'different-account' });
    await expect(s.runner.stage(s.task, s.file)).rejects.toMatchObject({
      code: 'GALLERY_TASK_CONTEXT_CHANGED'
    });
    expect(s.call).not.toHaveBeenCalled();
  });
  it('requires manual resume, reconciles first and skips already confirmed parts', async () => {
    const s = await setup(VIDEO_UPLOAD_PART_BYTES + 24);
    s.setTask({
      ...s.task,
      status: 'staging',
      parts: s.task.parts.map((part, i) => (i === 0 ? { ...part, status: 'confirmed' } : part))
    });
    expect(s.call).not.toHaveBeenCalled();
    await s.runner.stage(s.task, s.file);
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['reconcile', 'part', 'complete']);
    expect(s.call.mock.calls[1]?.[0]).toMatchObject({ partNumber: 2 });
  });
  it('stops pending readback timers on close without claiming platform success', async () => {
    const s = await setup();
    vi.useFakeTimers();
    const promise = s.runner.verifyUntilSettled({
      ...s.task,
      status: 'accepted',
      acceptedTimeUtc: Date.now()
    });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'VIDEO_UPLOAD_PAUSED' });
    s.runner.stop();
    await assertion;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.call).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
