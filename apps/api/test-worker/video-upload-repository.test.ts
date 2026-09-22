import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { VideoUploadService } from '@one-vegetable/core/video-upload-service';
import fixture from '../../../mock/data/video/upload.json';
import { openD1Database } from '../src/db/d1-database';
import { SqlVideoUploadRepository } from '../src/video-uploads/repository';

it('persists video metadata in D1 with owner isolation, validation and atomic revision conflict', async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const database = openD1Database(env.DB);
  const repository = new SqlVideoUploadRepository(database.executor);
  const service = new VideoUploadService(repository, () =>
    Promise.resolve({
      context: fixture.context,
      storage: null,
      platform: {
        find: () => Promise.resolve([]),
        upload: () => Promise.reject(new Error('unexpected write'))
      },
      enabled: false
    })
  );
  const result = await service.execute('worker-admin', {
    requestId: crypto.randomUUID(),
    context: fixture.context,
    command: { action: 'create', title: 'Fixture video', source: { kind: 'url', url: fixture.sourceUrl } }
  });
  const task = result.tasks[0];
  if (!task) throw new Error('task missing');
  const read = await new SqlVideoUploadRepository(database.executor).get(task.id, 'worker-admin');
  if (!read) throw new Error('receipt missing');
  expect(read.task.revision).toBe(1);
  expect(read.cancelAttempted).toBe(false);
  expect(JSON.stringify(read)).not.toContain(fixture.sourceUrl);
  expect(await repository.get(task.id, 'other-admin')).toBeNull();
  const change = { ...read, cancelAttempted: true, task: { ...read.task, revision: 2 } };
  await repository.save(change, 1);
  await expect(repository.save(change, 1)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
  expect((await repository.list('worker-admin'))[0]?.task.revision).toBe(2);
  expect(
    (await new SqlVideoUploadRepository(database.executor).get(task.id, 'worker-admin'))?.cancelAttempted
  ).toBe(true);
  await database.executor.execute('UPDATE video_upload_tasks SET record_json = ? WHERE id = ?', [
    '{"task":"bad"}',
    task.id
  ]);
  await expect(repository.get(task.id, 'worker-admin')).rejects.toThrow('VIDEO_TASK_CORRUPT');
});
