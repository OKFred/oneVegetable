import {
  orderAttachmentFail,
  parseOrderAttachmentRecord,
  type OrderAttachmentRecord,
  type OrderAttachmentRepository
} from '@one-vegetable/core/order-attachments';
import type { SqlExecutor } from '../db/sql-executor';

/** The same parameterized statements run on the existing Node SQLite and D1 executors. */
export class SqlOrderAttachmentRepository implements OrderAttachmentRepository {
  constructor(private readonly executor: SqlExecutor) {}
  async get(jobId: string, ownerId: string): Promise<OrderAttachmentRecord | null> {
    const rows = await this.executor.query(
      'SELECT record_json FROM order_attachment_jobs WHERE job_id = ? AND owner_id = ?',
      [jobId, ownerId]
    );
    if (!rows[0]) return null;
    let record: OrderAttachmentRecord;
    try {
      const json = rows[0].record_json;
      if (typeof json !== 'string' || json.length > 16384)
        orderAttachmentFail('ORDER_ATTACHMENT_RECORD_CORRUPT');
      record = parseOrderAttachmentRecord(JSON.parse(json));
    } catch {
      return orderAttachmentFail('ORDER_ATTACHMENT_RECORD_CORRUPT');
    }
    if (record.ownerId !== ownerId || record.receipt.jobId !== jobId)
      orderAttachmentFail('ORDER_ATTACHMENT_RECORD_CORRUPT');
    return record;
  }
  async insert(value: OrderAttachmentRecord): Promise<boolean> {
    const record = parseOrderAttachmentRecord(value);
    if (record.receipt.status !== 'sending') orderAttachmentFail('ORDER_ATTACHMENT_RECORD_CORRUPT');
    const result = await this.executor.execute(
      'INSERT INTO order_attachment_jobs (job_id, owner_id, fingerprint, record_json) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [record.receipt.jobId, record.ownerId, record.fingerprint, JSON.stringify(record)]
    );
    return result.changes === 1;
  }
  async finish(value: OrderAttachmentRecord): Promise<void> {
    const record = parseOrderAttachmentRecord(value);
    if (record.receipt.status === 'sending') orderAttachmentFail('ORDER_ATTACHMENT_RECORD_CORRUPT');
    const result = await this.executor.execute(
      "UPDATE order_attachment_jobs SET record_json = ? WHERE job_id = ? AND owner_id = ? AND fingerprint = ? AND json_extract(record_json, '$.receipt.status') = 'sending'",
      [JSON.stringify(record), record.receipt.jobId, record.ownerId, record.fingerprint]
    );
    if (result.changes !== 1) orderAttachmentFail('ORDER_ATTACHMENT_REQUEST_CONFLICT');
  }
}
