/** Decimal MB, measured on the final Store ZIP, not the unpacked extension. */
export const EXTENSION_ZIP_MAX_BYTES = 2_500_000;

/** Total unpacked file bytes, independent of per-chunk and security gates. */
export const EXTENSION_UNPACKED_MAX_BYTES = 8_500_000;

export const PACKING_THREE_MAX_BYTES = 1_000_000;
export const PACKING_WORKER_MAX_BYTES = 50_000;

export function assertPackingWorkerBudget(chunks: { file: string; size: number }[]): void {
  const workers = chunks.filter(({ file }) => /(?:^|\/)packing\.worker-[A-Za-z0-9_-]+\.js$/u.test(file));
  const worker = workers[0];
  if (!worker || workers.length !== 1) {
    throw new Error(`Expected exactly one packing.worker JavaScript chunk: ${workers.length}`);
  }
  if (!Number.isSafeInteger(worker.size) || worker.size < 0 || worker.size > PACKING_WORKER_MAX_BYTES) {
    throw new Error(
      `${worker.file} exceeds the 50 KB packing worker budget (${PACKING_WORKER_MAX_BYTES} bytes): ${worker.size}`
    );
  }
}

export function assertPackingThreeBudget(
  chunks: { file: string; size: number }[],
  eagerFiles: string[]
): string {
  const vendors = chunks.filter(({ file }) => /(?:^|\/)packing-three-[A-Za-z0-9_-]+\.js$/u.test(file));
  const vendor = vendors[0];
  if (!vendor || vendors.length !== 1) {
    throw new Error(`Expected exactly one packing-three JavaScript chunk: ${vendors.length}`);
  }
  if (!Number.isSafeInteger(vendor.size) || vendor.size < 0 || vendor.size > PACKING_THREE_MAX_BYTES) {
    throw new Error(
      `${vendor.file} exceeds the 1 MB packing-three budget (${PACKING_THREE_MAX_BYTES} bytes): ${vendor.size}`
    );
  }
  if (eagerFiles.includes(vendor.file)) {
    throw new Error(`packing-three must not be in the background or eager page graph: ${vendor.file}`);
  }
  return vendor.file;
}

export function assertExtensionZipBudget(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > EXTENSION_ZIP_MAX_BYTES) {
    throw new Error(`Extension ZIP exceeds 2.5 MB (${EXTENSION_ZIP_MAX_BYTES} bytes): ${byteLength}`);
  }
}

export function assertExtensionUnpackedBudget(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > EXTENSION_UNPACKED_MAX_BYTES) {
    throw new Error(
      `Unpacked extension exceeds 8.5 MB (${EXTENSION_UNPACKED_MAX_BYTES} bytes): ${byteLength}`
    );
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
