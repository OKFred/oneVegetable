import { shippingServicesFail, type ShippingProviderId } from '@one-vegetable/core/shipping-services';

import type { SqlExecutor } from '../db/sql-executor';

export const SHIPPING_DAILY_ATTEMPT_LIMIT = 10;
export const SHIPPING_ATTEMPT_RETENTION_MS = 30 * 86_400_000;
export const SHIPPING_SERIAL_LEASE_MS = 60_000;

export interface ShippingConfigurationRecord {
  ownerId: string;
  provider: ShippingProviderId;
  ciphertext: string | null;
  initializationVector: string | null;
  revision: number;
  updatedAtUtc: number;
}

export class SqlShippingServicesRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async prune(ownerId: string, now: number): Promise<void> {
    // Fixed recent deduplication window; credential clearing never resets attempts.
    await this.executor.execute(
      'DELETE FROM shipping_quote_attempts WHERE owner_id = ? AND attempted_at_utc < ?',
      [ownerId, now - SHIPPING_ATTEMPT_RETENTION_MS]
    );
    // Release only the serial lease, not the request ID or daily charge count.
    await this.executor.execute(
      `UPDATE shipping_quote_attempts SET completed_at_utc = ?
       WHERE owner_id = ? AND completed_at_utc IS NULL AND attempted_at_utc <= ?`,
      [now, ownerId, now - SHIPPING_SERIAL_LEASE_MS]
    );
  }

  async find(ownerId: string, provider: ShippingProviderId): Promise<ShippingConfigurationRecord | null> {
    const row = (
      await this.executor.query(
        'SELECT * FROM shipping_service_configurations WHERE owner_id = ? AND provider = ?',
        [ownerId, provider]
      )
    )[0];
    if (!row) return null;
    if (
      row.owner_id !== ownerId ||
      row.provider !== provider ||
      !(row.ciphertext === null || typeof row.ciphertext === 'string') ||
      !(row.initialization_vector === null || typeof row.initialization_vector === 'string') ||
      (row.ciphertext === null) !== (row.initialization_vector === null) ||
      typeof row.revision !== 'number' ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      typeof row.updated_at_utc !== 'number' ||
      !Number.isSafeInteger(row.updated_at_utc)
    )
      shippingServicesFail('SHIPPING_CONFIGURATION_UNREADABLE');
    return {
      ownerId,
      provider,
      ciphertext: row.ciphertext,
      initializationVector: row.initialization_vector,
      revision: row.revision,
      updatedAtUtc: row.updated_at_utc
    };
  }

  async save(record: ShippingConfigurationRecord, expectedRevision: number | null): Promise<void> {
    const result =
      expectedRevision === null
        ? await this.executor.execute(
            `INSERT INTO shipping_service_configurations
           (owner_id, provider, ciphertext, initialization_vector, revision, updated_at_utc)
           VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(owner_id, provider) DO NOTHING`,
            [
              record.ownerId,
              record.provider,
              record.ciphertext,
              record.initializationVector,
              record.updatedAtUtc
            ]
          )
        : await this.executor.execute(
            `UPDATE shipping_service_configurations SET ciphertext = ?, initialization_vector = ?,
           revision = revision + 1, updated_at_utc = ?
           WHERE owner_id = ? AND provider = ? AND revision = ?`,
            [
              record.ciphertext,
              record.initializationVector,
              record.updatedAtUtc,
              record.ownerId,
              record.provider,
              expectedRevision
            ]
          );
    if (result.changes !== 1) shippingServicesFail('SHIPPING_CONFIGURATION_CHANGED');
  }

  async hasAttempt(ownerId: string, requestId: string): Promise<boolean> {
    return (
      (
        await this.executor.query(
          'SELECT 1 FROM shipping_quote_attempts WHERE owner_id = ? AND request_id = ?',
          [ownerId, requestId]
        )
      ).length !== 0
    );
  }

  async claim(record: ShippingConfigurationRecord, requestId: string, now: number): Promise<void> {
    const day = Math.floor(now / 86_400_000);
    // One statement linearizes the exact credential snapshot, deduplication, daily budget and serial lock.
    const result = await this.executor.execute(
      `INSERT INTO shipping_quote_attempts
       (owner_id, request_id, provider, configuration_revision, day_utc, attempted_at_utc)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM shipping_service_configurations
         WHERE owner_id = ? AND provider = ? AND revision = ?
           AND ciphertext = ? AND initialization_vector = ? AND ciphertext IS NOT NULL
       ) AND (SELECT COUNT(*) FROM shipping_quote_attempts
              WHERE owner_id = ? AND provider = ? AND day_utc = ?) < ?
         AND NOT EXISTS (SELECT 1 FROM shipping_quote_attempts
                         WHERE owner_id = ? AND provider = ? AND completed_at_utc IS NULL)
       ON CONFLICT(owner_id, request_id) DO NOTHING`,
      [
        record.ownerId,
        requestId,
        record.provider,
        record.revision,
        day,
        now,
        record.ownerId,
        record.provider,
        record.revision,
        record.ciphertext,
        record.initializationVector,
        record.ownerId,
        record.provider,
        day,
        SHIPPING_DAILY_ATTEMPT_LIMIT,
        record.ownerId,
        record.provider
      ]
    );
    if (result.changes === 1) return;
    if (await this.hasAttempt(record.ownerId, requestId)) shippingServicesFail('SHIPPING_QUOTE_ALREADY_SENT');
    const current = await this.find(record.ownerId, record.provider);
    if (
      current?.revision !== record.revision ||
      current.ciphertext !== record.ciphertext ||
      current.initializationVector !== record.initializationVector
    )
      shippingServicesFail('SHIPPING_CONFIGURATION_CHANGED');
    const count = (
      await this.executor.query(
        'SELECT COUNT(*) AS total FROM shipping_quote_attempts WHERE owner_id = ? AND provider = ? AND day_utc = ?',
        [record.ownerId, record.provider, day]
      )
    )[0]?.total;
    if (typeof count === 'number' && count >= SHIPPING_DAILY_ATTEMPT_LIMIT)
      shippingServicesFail('SHIPPING_LOCAL_DAILY_LIMIT');
    shippingServicesFail('SHIPPING_QUOTE_IN_PROGRESS');
  }

  async complete(ownerId: string, requestId: string, now: number, outcomeUnknown = true): Promise<void> {
    await this.executor.execute(
      `UPDATE shipping_quote_attempts SET completed_at_utc = ?, outcome_unknown = ?
       WHERE owner_id = ? AND request_id = ? AND completed_at_utc IS NULL`,
      [now, outcomeUnknown ? 1 : 0, ownerId, requestId]
    );
  }
}
