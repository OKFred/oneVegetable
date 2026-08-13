export type UnixEpochMilliseconds = number;

export interface EntityAuditFields {
  createTimeUtc: UnixEpochMilliseconds;
  updateTimeUtc: UnixEpochMilliseconds;
  creatorId: string;
  updaterId: string;
  revision: number;
  remark: string | null;
}

export function createEntityAuditFields(
  actorId: string,
  now: UnixEpochMilliseconds,
  remark?: string | null
): EntityAuditFields {
  assertAuditActor(actorId);
  assertUnixEpochMilliseconds(now);
  return {
    createTimeUtc: now,
    updateTimeUtc: now,
    creatorId: actorId,
    updaterId: actorId,
    revision: 1,
    remark: normalizeRemark(remark)
  };
}

export function updateEntityAuditFields(
  current: EntityAuditFields,
  actorId: string,
  now: UnixEpochMilliseconds,
  remark: string | null
): EntityAuditFields {
  assertAuditActor(actorId);
  assertUnixEpochMilliseconds(now);
  return {
    ...current,
    updateTimeUtc: now,
    updaterId: actorId,
    revision: current.revision + 1,
    remark: normalizeRemark(remark)
  };
}

export function normalizeRemark(value: string | null | undefined): string | null {
  const remark = value?.trim() ?? '';
  if (!remark) return null;
  const characterCount = Array.from(
    new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(remark)
  ).length;
  if (characterCount > 500) throw new Error('remark 不能超过 500 个 Unicode 字符');
  return remark;
}

export function assertUnixEpochMilliseconds(value: number): asserts value is UnixEpochMilliseconds {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('时间必须是 Unix Epoch 毫秒整数');
}

function assertAuditActor(actorId: string): void {
  if (!actorId.trim()) throw new Error('审计主体不能为空');
}
