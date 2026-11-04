/** Decimal MB, measured on the final Store ZIP, not the unpacked extension. */
export const EXTENSION_ZIP_MAX_BYTES = 2_000_000;

/** Total unpacked file bytes, independent of per-chunk and security gates. */
export const EXTENSION_UNPACKED_MAX_BYTES = 7_000_000;

export function assertExtensionZipBudget(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > EXTENSION_ZIP_MAX_BYTES) {
    throw new Error(`Extension ZIP exceeds 2 MB (${EXTENSION_ZIP_MAX_BYTES} bytes): ${byteLength}`);
  }
}

export function assertExtensionUnpackedBudget(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > EXTENSION_UNPACKED_MAX_BYTES) {
    throw new Error(`Unpacked extension exceeds 7 MB (${EXTENSION_UNPACKED_MAX_BYTES} bytes): ${byteLength}`);
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
