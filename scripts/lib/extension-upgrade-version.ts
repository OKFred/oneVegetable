export function supportsUpgradeCredentialRecovery(version: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) throw new Error('UPGRADE_INVALID_VERSION');
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  return major > 2 || (major === 2 && (minor > 16 || (minor === 16 && patch >= 1)));
}
