import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqlOrderAttachmentRepository } from '../src/order-attachments/repository';
import { openNodeDatabase, applyNodeMigrations, type NodeDatabaseHandle } from '../src/db/node-database';
import { openD1Database } from '../src/db/d1-database';
import {
  OrderAttachmentService,
  type OrderAttachmentRecord
} from '../../../packages/core/src/order-attachments';

let database: NodeDatabaseHandle | undefined;
afterEach(() => {
  database?.connection.close();
  database = undefined;
});
function setup(d1 = false) {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  if (!database.connection.prepare('SELECT 1 FROM schema_migrations WHERE version = 19').get())
    database.connection.exec(
      readFileSync(new URL('../drizzle/0019_order_attachment_jobs.sql', import.meta.url), 'utf8')
    );
  if (!d1) return new SqlOrderAttachmentRepository(database.executor);
  // Exercise the actual D1 executor contract with the same SQLite statements, no remote account.
  const connection = database.connection;
  const binding = {
    prepare(sql: string) {
      return {
        bind(...params: (string | number | null)[]) {
          return {
            all() {
              return Promise.resolve({ success: true, results: connection.prepare(sql).all(...params) });
            },
            run() {
              return Promise.resolve({
                success: true,
                meta: { changes: Number(connection.prepare(sql).run(...params).changes) }
              });
            }
          };
        }
      };
    }
  } as unknown as Parameters<typeof openD1Database>[0];
  return new SqlOrderAttachmentRepository(openD1Database(binding).executor);
}
function record(): OrderAttachmentRecord {
  const id = crypto.randomUUID();
  return {
    ownerId: 'admin',
    context: { identity: 'a'.repeat(64), gateway: 'b'.repeat(64), storage: null },
    fingerprint: 'c'.repeat(64),
    receipt: {
      jobId: id,
      requestId: id,
      status: 'sending',
      fileName: 'invoice.pdf',
      sha256: 'd'.repeat(64),
      size: 9,
      createdTimeUtc: 100,
      updatedTimeUtc: 100,
      gatewayId: 'b'.repeat(64),
      protocol: 'iop',
      platformReference: null,
      errorCode: null,
      traceId: null
    }
  };
}
for (const d1 of [false, true])
  describe(d1 ? 'D1 executor order attachment repository' : 'SQLite order attachment repository', () => {
    it('reads a stopped sending job as unknown without network or storage rewrites and rejects same-SHA new IDs', async () => {
      const repository = setup(d1);
      const file = {
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        byteLength: 9,
        contentBase64: btoa('%PDF-1.7\n')
      };
      const context = { identity: 'a'.repeat(64), gateway: 'b'.repeat(64), storage: null };
      const send = vi.fn().mockResolvedValue({ reference: '/attachments/opaque.pdf' });
      const binding = { ownerId: 'admin', context, protocol: 'iop' as const, enabled: true, send };
      const requestId = crypto.randomUUID();
      const finish = vi
        .spyOn(repository, 'finish')
        .mockRejectedValueOnce(new Error('simulated shutdown before receipt commit'));
      await expect(
        new OrderAttachmentService(repository, binding, () => 100).upload({ requestId, context, file })
      ).rejects.toThrow('simulated shutdown');
      const restarted = new OrderAttachmentService(
        repository,
        { ...binding, send: vi.fn().mockRejectedValue(new Error('must not send')) },
        () => 100_000
      );
      expect(await restarted.get({ requestId: crypto.randomUUID(), jobId: requestId })).toMatchObject({
        status: 'unknown',
        errorCode: 'ORDER_ATTACHMENT_RESULT_UNKNOWN'
      });
      expect(await repository.get(requestId, 'admin')).toMatchObject({ receipt: { status: 'sending' } });
      await expect(restarted.upload({ requestId: crypto.randomUUID(), context, file })).rejects.toThrow(
        'ORDER_ATTACHMENT_UPLOAD_PENDING'
      );
      expect(send).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledOnce();
    });
    it('isolates owners and round-trips only allowlisted metadata', async () => {
      const repository = setup(d1);
      const r = record();
      expect(await repository.insert(r)).toBe(true);
      expect(await repository.get(r.receipt.jobId, 'admin')).toEqual(r);
      expect(await repository.get(r.receipt.jobId, 'other')).toBeNull();
      await expect(
        repository.insert({ ...r, contentBase64: 'secret' } as OrderAttachmentRecord)
      ).rejects.toThrow('ORDER_ATTACHMENT_RECORD_CORRUPT');
      const row = database?.connection.prepare('SELECT record_json FROM order_attachment_jobs').get();
      if (!row) throw new Error('fixture row missing');
      const json = row.record_json;
      expect(String(json)).not.toContain('contentBase64');
      expect(String(json)).not.toContain('accessToken');
    });
    it('atomically rejects same-ID and pending-content races, including changed request IDs', async () => {
      const repository = setup(d1);
      const a = record();
      const b = record();
      expect(await Promise.all([repository.insert(a), repository.insert(b)])).toEqual([true, false]);
      expect(await repository.insert({ ...a, ownerId: 'other' })).toBe(false);
      expect(await repository.insert({ ...a, fingerprint: 'f'.repeat(64) })).toBe(false);
      expect(await repository.get(a.receipt.jobId, 'admin')).toEqual(a);
      a.receipt.status = 'unknown';
      a.receipt.errorCode = 'ORDER_ATTACHMENT_RESULT_UNKNOWN';
      await repository.finish(a);
      expect(await repository.insert(b)).toBe(false);
    });
    it('allows explicit same-content uploads only after acceptance', async () => {
      const repository = setup(d1);
      const a = record();
      await repository.insert(a);
      a.receipt.status = 'accepted';
      a.receipt.platformReference = '/attachments/opaque-file.pdf';
      await repository.finish(a);
      expect(await repository.get(a.receipt.jobId, 'admin')).toEqual(a);
      expect(await repository.insert(record())).toBe(true);
      await expect(repository.finish(a)).rejects.toThrow('ORDER_ATTACHMENT_REQUEST_CONFLICT');
    });
    it('preserves owner, context, original file and timestamps across completion', async () => {
      const repository = setup(d1);
      const r = record();
      await repository.insert(r);
      const changed = structuredClone(r);
      changed.receipt.status = 'unknown';
      changed.receipt.errorCode = 'ORDER_ATTACHMENT_RESULT_UNKNOWN';
      changed.receipt.fileName = 'different.pdf';
      await expect(repository.finish(changed)).rejects.toThrow('ORDER_ATTACHMENT_RECORD_CORRUPT');
      expect(await repository.get(r.receipt.jobId, 'admin')).toEqual(r);
      await expect(repository.finish({ ...changed, fingerprint: 'e'.repeat(64) })).rejects.toThrow(
        'ORDER_ATTACHMENT_REQUEST_CONFLICT'
      );
    });
    it('scopes pending-content exclusion to owner, gateway and SHA', async () => {
      const repository = setup(d1);
      await repository.insert(record());
      const owner = record();
      owner.ownerId = 'other';
      const gateway = record();
      gateway.context.gateway = 'e'.repeat(64);
      gateway.receipt.gatewayId = gateway.context.gateway;
      const hash = record();
      hash.receipt.sha256 = 'e'.repeat(64);
      expect(await repository.insert(owner)).toBe(true);
      expect(await repository.insert(gateway)).toBe(true);
      expect(await repository.insert(hash)).toBe(true);
    });
  });
