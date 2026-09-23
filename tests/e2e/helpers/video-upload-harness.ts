import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import fixture from '../../../mock/data/video/upload.json' with { type: 'json' };
import {
  VideoUploadService,
  type VideoUploadRecord,
  type VideoUploadRepository,
  type VideoUploadStorage
} from '../../../packages/core/src/video-upload-service';
import type { VideoUploadCommand, VideoUploadResult } from '../../../packages/core/src/video-upload';

/** Test-only boundary: real upload state machine, memory repository and in-memory S3/platform.
 * The fake driver is injected by Playwright after Vue mounts, never shipped in a runtime bundle.
 */
export function createVideoUploadHarness(enabled = true) {
  const records = new Map<string, VideoUploadRecord>();
  const parts = new Map<number, Uint8Array>();
  const uploaded: { id: string; title: string }[] = [];
  const commands: { action: VideoUploadCommand['action']; partNumber?: number; bytes?: number }[] = [];
  let finalBytes = new Uint8Array();
  let gate: { started: () => void; wait: Promise<void> } | null = null;
  const repository: VideoUploadRepository = {
    get(id, owner) {
      const row = records.get(id);
      return Promise.resolve(row?.ownerId === owner ? structuredClone(row) : null);
    },
    list(owner) {
      return Promise.resolve(
        [...records.values()].filter((row) => row.ownerId === owner).map((row) => structuredClone(row))
      );
    },
    save(row, revision) {
      if ((records.get(row.task.id)?.task.revision ?? null) !== revision)
        return Promise.reject(new Error('ENTITY_VERSION_CONFLICT'));
      records.set(row.task.id, structuredClone(row));
      return Promise.resolve();
    }
  };
  function partInfo(partNumber: number, bytes: Uint8Array) {
    return {
      partNumber,
      size: bytes.length,
      etag: `fixture-${partNumber}`,
      checksumSha256: createHash('sha256').update(bytes).digest('base64')
    };
  }
  const storage: VideoUploadStorage = {
    createMultipart: () => Promise.resolve('fixture-upload-id'),
    async uploadPart(_key, _uploadId, partNumber, bytes) {
      const hold = gate;
      if (hold) {
        gate = null;
        hold.started();
        await hold.wait;
      }
      parts.set(partNumber, new Uint8Array(bytes));
      return partInfo(partNumber, bytes);
    },
    listParts: () => Promise.resolve([...parts].map(([number, bytes]) => partInfo(number, bytes))),
    completeMultipart() {
      finalBytes = new Uint8Array(
        Buffer.concat([...parts].sort(([a], [b]) => a - b).map(([, bytes]) => bytes))
      );
      return Promise.resolve();
    },
    abortMultipart() {
      parts.clear();
      return Promise.resolve();
    },
    headVideoObject: () => Promise.resolve({ size: finalBytes.length, etag: 'fixture-complete' }),
    getVideoRange: (_key, start, end) => Promise.resolve(finalBytes.slice(start, end + 1)),
    presignVideoGet: () => Promise.resolve(fixture.sourceUrl),
    checkPresignedVideoGet: () => Promise.resolve()
  };
  const service = new VideoUploadService(repository, () =>
    Promise.resolve({
      context: fixture.context,
      storage,
      enabled,
      platform: {
        find: (title) => Promise.resolve(uploaded.filter((video) => video.title === title)),
        upload(_url, title) {
          uploaded.push({ id: `fixture-video-${uploaded.length + 1}`, title });
          return Promise.resolve({ accepted: true, traceId: 'fixture-upload-trace' });
        }
      }
    })
  );
  const bind = async (page: Page) => {
    await page.exposeFunction(
      '__videoUploadOfflineCall',
      (command: VideoUploadCommand, context: unknown, requestId: string | undefined) => {
        commands.push({
          action: command.action,
          ...(command.action === 'part'
            ? { partNumber: command.partNumber, bytes: Buffer.from(command.contentBase64, 'base64').length }
            : {})
        });
        return service.execute('fixture-admin', {
          command,
          context,
          requestId: requestId ?? crypto.randomUUID()
        });
      }
    );
  };
  const install = async (page: Page) => {
    await page.getByTestId('video-library').waitFor();
    await page.evaluate((context) => {
      // Explicit test-only Vue injection. No hooks or test drivers are added to production source.
      function object(value: unknown): Record<PropertyKey, unknown> {
        if (!value || typeof value !== 'object') throw new Error('Missing Vue test host');
        return value as Record<PropertyKey, unknown>;
      }
      const root = document.querySelector('#app');
      const app = object(root && Reflect.get(root, '__vue_app__'));
      const provides = object(object(app._instance).provides);
      const key = Reflect.ownKeys(provides).find(
        (item) => typeof item === 'symbol' && item.description === 'one-vegetable-services'
      );
      if (!key) throw new Error('App services unavailable');
      const services = object(provides[key]);
      const call = (
        globalThis as unknown as {
          __videoUploadOfflineCall: (
            command: unknown,
            context: unknown,
            requestId?: string
          ) => Promise<VideoUploadResult>;
        }
      ).__videoUploadOfflineCall;
      services.videoUploads = {
        videoUpload: (command: unknown, current: unknown, requestId?: string) =>
          call(command, current, requestId)
      };
      object(services.gateway).galleryTransferContext = () => Promise.resolve(context);
    }, fixture.context);
  };
  return {
    bind,
    install,
    commands,
    records,
    uploaded,
    holdNextPart() {
      let started: () => void = () => {
        throw new Error('Missing started resolver');
      };
      let release: () => void = () => {
        throw new Error('Missing release resolver');
      };
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { started, wait };
      return { waiting, release };
    }
  };
}
