/** Permission evidence is an import-time snapshot, not a live application entitlement check. */
export interface AlibabaAuthorizationMetadata {
  systemApiPermission: 'active' | 'inactive' | 'not-recorded' | 'unknown';
  permissionCapturedTimeUtc: number | null;
}

export function alibabaAuthorizationMetadata(value: unknown): AlibabaAuthorizationMetadata {
  const root = record(value);
  const permissions = record(root.application).permissions;
  const unknown: AlibabaAuthorizationMetadata = {
    systemApiPermission: 'unknown',
    permissionCapturedTimeUtc: null
  };
  if (!Array.isArray(permissions) || !permissions.length) return unknown;
  const entries: unknown[] = permissions;
  if (
    entries.some((item) => typeof record(item).name !== 'string' || typeof record(item).status !== 'string')
  )
    return unknown;
  // SystemAPI is a different, legacy group. Never remove the space when matching.
  const matches = entries.map(record).filter((item) => String(item.name).trim() === 'System API');
  const statuses = matches.map((item) => String(item.status).trim().toLowerCase());
  // Token refresh can update capturedAtUtc without rereading application permissions.
  const capturedAt = record(root.callback).receivedAtUtc ?? root.capturedAtUtc;
  const captured = typeof capturedAt === 'string' ? Date.parse(capturedAt) : NaN;
  return {
    systemApiPermission: statuses.includes('active')
      ? 'active'
      : statuses.some((status) => ['inactive', 'pending', 'rejected', 'disabled', 'expired'].includes(status))
        ? 'inactive'
        : matches.length
          ? 'unknown'
          : 'not-recorded',
    permissionCapturedTimeUtc: Number.isSafeInteger(captured) && captured >= 0 ? captured : null
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
