export interface ExtensionRuntimeSenderIdentity {
  id?: string;
  url?: string;
}

export function isTrustedExtensionPageSender(
  sender: ExtensionRuntimeSenderIdentity,
  extensionId: string,
  trustedPageUrl: string
): boolean {
  if (sender.id !== extensionId || typeof sender.url !== 'string') return false;
  try {
    const actual = new URL(sender.url);
    const expected = new URL(trustedPageUrl);
    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}
