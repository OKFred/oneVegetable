import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import { OrderAttachmentService } from '@one-vegetable/core/order-attachments';
import fixture from '../../../mock/data/order-fulfillment/attachment.json';
import { openD1Database } from '../src/db/d1-database';
import { SqlOrderAttachmentRepository } from '../src/order-attachments/repository';

it('persists before one upload and isolates D1 attachment receipts by owner', async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const repository = new SqlOrderAttachmentRepository(openD1Database(env.DB).executor);
  const requestId = crypto.randomUUID();
  const send = vi.fn(async () => {
    expect((await repository.get(requestId, 'worker-admin'))?.receipt.status).toBe('sending');
    return { reference: fixture.reference };
  });
  const service = new OrderAttachmentService(repository, {
    ownerId: 'worker-admin',
    context: fixture.context,
    protocol: 'iop',
    enabled: true,
    send
  });
  const request = { requestId, context: fixture.context, file: fixture.file };
  const result = await service.upload(request);
  expect(result.status).toBe('accepted');
  expect(await service.upload(request)).toEqual(result);
  expect(send).toHaveBeenCalledOnce();
  expect(await repository.get(requestId, 'another-admin')).toBeNull();
  expect(JSON.stringify(await repository.get(requestId, 'worker-admin'))).not.toContain(
    fixture.file.contentBase64
  );
});

it('retains an unknown claim and blocks a new request ID for the same content in D1', async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const repository = new SqlOrderAttachmentRepository(openD1Database(env.DB).executor);
  const send = vi.fn(() => Promise.reject(new Error('fixture lost response')));
  const service = new OrderAttachmentService(repository, {
    ownerId: 'worker-unknown',
    context: fixture.context,
    protocol: 'iop',
    enabled: true,
    send
  });
  const request = { requestId: crypto.randomUUID(), context: fixture.context, file: fixture.file };
  expect((await service.upload(request)).status).toBe('unknown');
  await expect(service.upload({ ...request, requestId: crypto.randomUUID() })).rejects.toThrow(
    'ORDER_ATTACHMENT_UPLOAD_PENDING'
  );
  expect(send).toHaveBeenCalledOnce();
});
