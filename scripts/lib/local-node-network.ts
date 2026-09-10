/** Local Node defaults only; keep explicit operator NODE_OPTIONS unchanged. */
export function localNodeNetworkOptions(existing = ''): string {
  const defaults: string[] = [];
  if (!existing.includes('--dns-result-order')) defaults.push('--dns-result-order=ipv4first');
  if (!existing.includes('--network-family-autoselection-attempt-timeout')) {
    defaults.push('--network-family-autoselection-attempt-timeout=2000');
  }
  return [existing.trim(), ...defaults].filter(Boolean).join(' ');
}
