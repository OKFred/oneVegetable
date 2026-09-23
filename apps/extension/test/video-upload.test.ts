import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/video/upload.json';
import { VideoUploadService } from '@one-vegetable/core/video-upload-service';
import { ExtensionVideoUploadRepository } from '../lib/video-upload-repository';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: mocks.send } } }));
import { requestVideoUpload } from '../lib/video-upload-client';
import { handleVideoUpload } from '../lib/video-upload-service';
import type { GatewaySettings } from '@one-vegetable/core';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('extension video upload durable protocol', () => {
  it('persists across background repository restarts and atomically rejects stale updates', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const repository = new ExtensionVideoUploadRepository();
    const service = new VideoUploadService(repository, () =>
      Promise.resolve({
        context: fixture.context,
        storage: null,
        enabled: false,
        platform: {
          find: () => Promise.resolve([]),
          upload: () => Promise.reject(new Error('unexpected write'))
        }
      })
    );
    const result = await service.execute('extension:local-admin', {
      requestId: crypto.randomUUID(),
      context: fixture.context,
      command: { action: 'create', title: 'Fixture video', source: { kind: 'url', url: fixture.sourceUrl } }
    });
    const task = result.tasks[0];
    if (!task) throw new Error('task missing');
    const restarted = new ExtensionVideoUploadRepository();
    const record = await restarted.get(task.id, 'extension:local-admin');
    if (!record) throw new Error('missing receipt');
    expect(record.task).toEqual(task);
    expect(record.cancelAttempted).toBe(false);
    expect(await restarted.get(task.id, 'another-user')).toBeNull();
    const changed = { ...record, cancelAttempted: true, task: { ...task, revision: 2 } };
    const concurrent = await Promise.allSettled([repository.save(changed, 1), restarted.save(changed, 1)]);
    expect(concurrent.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect((await restarted.list('extension:local-admin'))[0]?.task.revision).toBe(2);
    expect(
      (await new ExtensionVideoUploadRepository().get(task.id, 'extension:local-admin'))?.cancelAttempted
    ).toBe(true);
    expect(JSON.stringify(record)).not.toContain(fixture.sourceUrl);
    const busy = {
      ...changed,
      busy: { action: 'part', until: Date.now() + 30_000 },
      task: { ...changed.task, revision: 3 }
    };
    await restarted.save(busy, 2);
    await expect(restarted.clearAll()).rejects.toThrow('VIDEO_TASK_BUSY');
    await restarted.save({ ...busy, busy: null, task: { ...busy.task, revision: 4 } }, 3);
    await restarted.clearAll();
    expect(await repository.list('extension:local-admin')).toEqual([]);
  });
  it('validates correlation and result contracts and never resends failed writes', async () => {
    const requestId = crypto.randomUUID();
    mocks.send.mockResolvedValue({
      requestId: crypto.randomUUID(),
      ok: true,
      data: { tasks: [], uploadEnabled: false }
    });
    await expect(requestVideoUpload({ action: 'list' }, fixture.context, requestId)).rejects.toThrow();
    mocks.send.mockResolvedValue({ requestId, ok: true, data: { tasks: [{}], uploadEnabled: false } });
    await expect(requestVideoUpload({ action: 'list' }, fixture.context, requestId)).rejects.toThrow();
    mocks.send.mockResolvedValue({ requestId, ok: false, error: { code: 'VIDEO_UPLOAD_DISABLED' } });
    await expect(
      requestVideoUpload(
        { action: 'create', title: 'Fixture', source: { kind: 'url', url: fixture.sourceUrl } },
        fixture.context,
        requestId
      )
    ).rejects.toMatchObject({ gatewayError: { code: 'VIDEO_UPLOAD_DISABLED', retryable: false } });
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });
  it('rejects untrusted senders before credential or storage access', async () => {
    const loadSettings = vi.fn<() => Promise<GatewaySettings>>();
    const s3 = { contextId: vi.fn(), videoClient: vi.fn() };
    const response = await handleVideoUpload(
      { requestId: crypto.randomUUID(), command: { action: 'list' }, context: fixture.context },
      false,
      s3,
      loadSettings
    );
    expect(response).toMatchObject({ ok: false, error: { code: 'VIDEO_UNTRUSTED_SENDER' } });
    expect(loadSettings).not.toHaveBeenCalled();
    expect(s3.contextId).not.toHaveBeenCalled();
  });
  it('preserves only sanitized storage diagnostics from the trusted response', async () => {
    const requestId = crypto.randomUUID();
    for (const subCode of ['HTTP_411:UnknownProviderError', 'https://secret.invalid?token=secret']) {
      mocks.send.mockResolvedValue({
        requestId,
        ok: false,
        error: {
          code: 'S3_REQUEST_FAILED',
          subCode,
          message: 'untrusted provider body'
        }
      });
      await expect(requestVideoUpload({ action: 'list' }, fixture.context, requestId)).rejects.toMatchObject({
        gatewayError: {
          code: 'S3_REQUEST_FAILED',
          message: 'S3_REQUEST_FAILED',
          retryable: false,
          ...(subCode.startsWith('HTTP_') ? { subCode } : {})
        }
      });
    }
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
