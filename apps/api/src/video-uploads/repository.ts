import { videoUploadFail } from '@one-vegetable/core/video-upload';
import {
  parseVideoUploadRecord,
  type VideoUploadRecord,
  type VideoUploadRepository
} from '@one-vegetable/core/video-upload-service';
import type { SqlExecutor } from '../db/sql-executor';

export class SqlVideoUploadRepository implements VideoUploadRepository {
  constructor(private readonly executor: SqlExecutor) {}
  async get(id: string, ownerId: string): Promise<VideoUploadRecord | null> {
    const rows = await this.executor.query(
      'SELECT record_json FROM video_upload_tasks WHERE id = ? AND owner_id = ?',
      [id, ownerId]
    );
    return rows[0] ? parse(rows[0].record_json, ownerId) : null;
  }
  async list(ownerId: string): Promise<VideoUploadRecord[]> {
    const rows = await this.executor.query(
      'SELECT record_json FROM video_upload_tasks WHERE owner_id = ? ORDER BY update_time_utc DESC LIMIT 100',
      [ownerId]
    );
    return rows.map((row) => parse(row.record_json, ownerId));
  }
  async save(record: VideoUploadRecord, expectedRevision: number | null): Promise<void> {
    const json = JSON.stringify(record);
    parse(json, record.ownerId);
    const result =
      expectedRevision === null
        ? await this.executor.execute(
            'INSERT OR IGNORE INTO video_upload_tasks (id, owner_id, revision, update_time_utc, record_json) VALUES (?, ?, ?, ?, ?)',
            [record.task.id, record.ownerId, record.task.revision, record.task.updateTimeUtc, json]
          )
        : await this.executor.execute(
            'UPDATE video_upload_tasks SET revision = ?, update_time_utc = ?, record_json = ? WHERE id = ? AND owner_id = ? AND revision = ?',
            [
              record.task.revision,
              record.task.updateTimeUtc,
              json,
              record.task.id,
              record.ownerId,
              expectedRevision
            ]
          );
    if (result.changes !== 1) videoUploadFail('ENTITY_VERSION_CONFLICT');
  }
}
function parse(json: unknown, ownerId: string): VideoUploadRecord {
  if (typeof json !== 'string' || json.length > 100_000) videoUploadFail('VIDEO_TASK_CORRUPT');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return videoUploadFail('VIDEO_TASK_CORRUPT');
  }
  const record = parseVideoUploadRecord(raw);
  if (record.ownerId !== ownerId) videoUploadFail('VIDEO_TASK_CORRUPT');
  return record;
}
