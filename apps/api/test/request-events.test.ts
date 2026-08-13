import { afterEach, describe, expect, it } from 'vitest';

import { requestEventRetentionCutoff, SqlRequestEventRepository } from '../src/observability/request-events';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

describe('request event repository', () => {
  it('stores only structured diagnostics, filters by requestId and purges by retention cutoff', async () => {
    database = openNodeDatabase(':memory:');
    applyNodeMigrations(database);
    const repository = new SqlRequestEventRepository(database.executor);
    const now = 1_723_456_789_012;
    await repository.append({
      id: crypto.randomUUID(),
      eventTimeUtc: now - 31 * 86_400_000,
      requestId: crypto.randomUUID(),
      environment: 'test',
      runtime: 'node',
      route: '/api/v1/auth/login',
      operation: 'auth/login',
      actorId: null,
      outcome: 'denied',
      statusCode: 401,
      durationMilliseconds: 12
    });
    const requestId = crypto.randomUUID();
    await repository.append({
      id: crypto.randomUUID(),
      eventTimeUtc: now,
      requestId,
      environment: 'test',
      runtime: 'node',
      route: '/api/v1/admin/system/get',
      operation: 'admin/system/get',
      actorId: 'admin-1',
      outcome: 'success',
      statusCode: 200,
      durationMilliseconds: 8
    });

    await expect(repository.list({ requestId, page: 1, pageSize: 20 })).resolves.toMatchObject({
      total: 1,
      items: [{ requestId, actorId: 'admin-1', durationMilliseconds: 8 }]
    });
    await expect(repository.purgeBefore(requestEventRetentionCutoff(now, 30))).resolves.toBe(1);
    await expect(repository.list({ page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 1 });
  });

  it('bounds the configured retention period', () => {
    expect(() => requestEventRetentionCutoff(Date.now(), 0)).toThrow('1–90');
    expect(() => requestEventRetentionCutoff(Date.now(), 91)).toThrow('1–90');
  });
});
