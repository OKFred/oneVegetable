/** Local metadata refresh only: do not invalidate business queries for vault storage writes. */
export const CREDENTIAL_VAULT_CHANGED_EVENT = 'one-vegetable:credential-vault-changed';

/** Session reads touch activity time. Only key/record/lock changes should reload Settings. */
export function isMaterialVaultSessionChange(change: { oldValue?: unknown; newValue?: unknown }): boolean {
  const { oldValue, newValue } = change;
  if (!isRecord(oldValue) || !isRecord(newValue)) return oldValue !== newValue;
  return [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].some(
    (key) => key !== 'lastActivityAt' && oldValue[key] !== newValue[key]
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function notifyCredentialVaultChanged(): void {
  globalThis.dispatchEvent(new Event(CREDENTIAL_VAULT_CHANGED_EVENT));
}
