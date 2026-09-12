/** Decimal MB, measured on the final Store ZIP, not the unpacked extension. */
export const EXTENSION_ZIP_MAX_BYTES = 1_500_000;

export function assertExtensionZipBudget(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > EXTENSION_ZIP_MAX_BYTES) {
    throw new Error(`Extension ZIP exceeds 1.5 MB (${EXTENSION_ZIP_MAX_BYTES} bytes): ${byteLength}`);
  }
}

export function assertStoreListingVersion(version: string, listing: unknown): void {
  if (
    typeof listing !== 'object' ||
    listing === null ||
    !('extensionVersion' in listing) ||
    listing.extensionVersion !== version
  ) {
    throw new Error(`Store listing extensionVersion must match workspace version ${version}`);
  }
}
