export interface AuditFilters {
  actorId: string;
  operation: string;
  outcome: '' | 'success' | 'error' | 'denied';
  from: string;
  to: string;
}
export function emptyAuditFilters(): AuditFilters {
  return { actorId: '', operation: '', outcome: '', from: '', to: '' };
}
export function auditFilterPayload(filters: AuditFilters) {
  return {
    ...(filters.actorId.trim() ? { actorId: filters.actorId.trim() } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.from ? { fromTimeUtc: new Date(filters.from).getTime() } : {}),
    ...(filters.to ? { toTimeUtc: new Date(filters.to).getTime() } : {})
  };
}
