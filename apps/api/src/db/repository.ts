import { and, eq } from 'drizzle-orm';

import { createEntityAuditFields, normalizeRemark, updateEntityAuditFields } from '@one-vegetable/core';

import { appMetadata } from './schema';

import type { EntityAuditFields, UnixEpochMilliseconds } from '@one-vegetable/core';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import type { schema } from './schema';

export interface AppMetadata extends EntityAuditFields {
  key: string;
  value: string;
}

export interface CreateAppMetadataInput {
  key: string;
  value: string;
  actorId: string;
  remark?: string | null;
}

export interface UpdateAppMetadataInput {
  key: string;
  value: string;
  expectedRevision: number;
  actorId: string;
  remark: string | null;
}

export interface AppMetadataRepository {
  get(key: string): Promise<AppMetadata | null>;
  create(input: CreateAppMetadataInput): Promise<AppMetadata>;
  update(input: UpdateAppMetadataInput): Promise<AppMetadata>;
}

type MetadataRow = typeof appMetadata.$inferSelect;
type MetadataInsert = typeof appMetadata.$inferInsert;

interface MetadataDataSource {
  find(key: string): Promise<MetadataRow | undefined>;
  insert(value: MetadataInsert): Promise<MetadataRow>;
  update(value: MetadataInsert, expectedRevision: number): Promise<MetadataRow | undefined>;
}

export class EntityVersionConflictError extends Error {
  constructor() {
    super('实体已被其他请求更新');
    this.name = 'EntityVersionConflictError';
  }
}

export class DefaultAppMetadataRepository implements AppMetadataRepository {
  readonly #dataSource: MetadataDataSource;
  readonly #clock: () => UnixEpochMilliseconds;

  constructor(dataSource: MetadataDataSource, clock: () => UnixEpochMilliseconds = Date.now) {
    this.#dataSource = dataSource;
    this.#clock = clock;
  }

  async get(key: string): Promise<AppMetadata | null> {
    const row = await this.#dataSource.find(key);
    return row ? toEntity(row) : null;
  }

  async create(input: CreateAppMetadataInput): Promise<AppMetadata> {
    const key = normalizeKey(input.key);
    const audit = createEntityAuditFields(input.actorId, this.#clock(), input.remark);
    const row = await this.#dataSource.insert({ key, value: input.value, ...audit });
    return toEntity(row);
  }

  async update(input: UpdateAppMetadataInput): Promise<AppMetadata> {
    const current = await this.get(normalizeKey(input.key));
    if (current?.revision !== input.expectedRevision) throw new EntityVersionConflictError();
    const audit = updateEntityAuditFields(current, input.actorId, this.#clock(), input.remark);
    const row = await this.#dataSource.update(
      {
        key: current.key,
        value: input.value,
        createTimeUtc: audit.createTimeUtc,
        updateTimeUtc: audit.updateTimeUtc,
        creatorId: audit.creatorId,
        updaterId: audit.updaterId,
        revision: audit.revision,
        remark: normalizeRemark(audit.remark)
      },
      input.expectedRevision
    );
    if (!row) throw new EntityVersionConflictError();
    return toEntity(row);
  }
}

export function createSqliteMetadataRepository(
  db: SqliteRemoteDatabase<typeof schema>,
  clock?: () => UnixEpochMilliseconds
): AppMetadataRepository {
  return new DefaultAppMetadataRepository(createSqliteDataSource(db), clock);
}

export function createD1MetadataRepository(
  db: DrizzleD1Database<typeof schema>,
  clock?: () => UnixEpochMilliseconds
): AppMetadataRepository {
  return new DefaultAppMetadataRepository(createD1DataSource(db), clock);
}

function createSqliteDataSource(db: SqliteRemoteDatabase<typeof schema>): MetadataDataSource {
  return {
    async find(key) {
      return (await db.select().from(appMetadata).where(eq(appMetadata.key, key)).limit(1))[0];
    },
    async insert(value) {
      const row = (await db.insert(appMetadata).values(value).returning())[0];
      if (!row) throw new Error('创建元数据失败');
      return row;
    },
    async update(value, expectedRevision) {
      return (
        await db
          .update(appMetadata)
          .set(value)
          .where(and(eq(appMetadata.key, value.key), eq(appMetadata.revision, expectedRevision)))
          .returning()
      )[0];
    }
  };
}

function createD1DataSource(db: DrizzleD1Database<typeof schema>): MetadataDataSource {
  return {
    async find(key) {
      return (await db.select().from(appMetadata).where(eq(appMetadata.key, key)).limit(1))[0];
    },
    async insert(value) {
      const row = (await db.insert(appMetadata).values(value).returning())[0];
      if (!row) throw new Error('创建元数据失败');
      return row;
    },
    async update(value, expectedRevision) {
      return (
        await db
          .update(appMetadata)
          .set(value)
          .where(and(eq(appMetadata.key, value.key), eq(appMetadata.revision, expectedRevision)))
          .returning()
      )[0];
    }
  };
}

function normalizeKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 128) throw new Error('元数据 key 无效');
  return key;
}

function toEntity(row: MetadataRow): AppMetadata {
  return { ...row };
}
