import { templateError } from '@one-vegetable/core/template-library';
import {
  parseTemplateMaterialDocument,
  templateMaterialManifest,
  TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES,
  type TemplateMaterialPackage
} from '@one-vegetable/core/template-materials';
import type { S3StorageControl, S3StorageConfigurationSummary } from '@one-vegetable/core/s3-storage';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import { galleryAssetSha256 } from './gallery-transfer-archive';
import { templateMaterialGalleryArchive } from './template-material-archive';
import { assertTemplateBackupContext } from './template-s3';
import {
  assertTemplateMaterialCurrent,
  type TemplateMaterialExportPlan,
  type TemplateMaterialProgress
} from './template-material-transfer';

export interface TemplateMaterialBackupPlan {
  key: string;
  configuration: S3StorageConfigurationSummary;
  context: GalleryTransferContext | null;
  entries: { key: string; bytes: Uint8Array; contentType: string }[];
  started: boolean;
}
const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
async function assertBackup(
  storage: S3StorageControl,
  plan: TemplateMaterialBackupPlan,
  isCurrent: () => boolean
) {
  await assertTemplateBackupContext(
    storage,
    { key: plan.key, bytes: new Uint8Array(), configuration: plan.configuration },
    isCurrent
  );
}

export async function prepareTemplateMaterialBackup(
  storage: S3StorageControl,
  exportPlan: TemplateMaterialExportPlan,
  prefix: string,
  isCurrent: () => boolean
): Promise<TemplateMaterialBackupPlan> {
  assertTemplateMaterialCurrent(isCurrent);
  const path = prefix.trim().replace(/\/$/u, '');
  if (
    !path ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[\\?#\p{Cc}]/u.test(path)
  )
    throw templateError('TEMPLATE_PREFIX_INVALID');
  await templateMaterialGalleryArchive(exportPlan.package);
  assertTemplateMaterialCurrent(isCurrent);
  const configuration = await storage.s3StorageConfiguration();
  if (!configuration.configured) throw templateError('S3_NOT_CONFIGURED');
  assertTemplateMaterialCurrent(isCurrent);
  const base = `${path}/${crypto.randomUUID()}`;
  const metadata = new Map(exportPlan.package.document.assets.map((asset) => [asset.path, asset]));
  return {
    key: `${base}/templates.json`,
    configuration,
    context: exportPlan.context,
    started: false,
    entries: [
      ...exportPlan.package.assets.map((asset) => {
        const meta = metadata.get(asset.path);
        if (!meta) throw templateError('TEMPLATE_MATERIAL_MISSING');
        return {
          key: `${base}/${asset.path}`,
          bytes: Uint8Array.from(asset.bytes),
          contentType: meta.contentType
        };
      }),
      {
        key: `${base}/templates.json`,
        bytes: templateMaterialManifest(exportPlan.package.document),
        contentType: 'application/json'
      }
    ]
  };
}
export async function executeTemplateMaterialBackup(
  storage: S3StorageControl,
  plan: TemplateMaterialBackupPlan,
  isCurrent: () => boolean,
  onProgress?: (value: TemplateMaterialProgress) => void
): Promise<void> {
  await assertBackup(storage, plan, isCurrent);
  if (plan.started) throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
  plan.started = true;
  const options = plan.context ? { galleryContext: plan.context } : undefined;
  for (const [index, entry] of plan.entries.entries()) {
    await assertBackup(storage, plan, isCurrent);
    await storage.putS3Object(entry, options);
    await assertBackup(storage, plan, isCurrent);
    const object = await storage.getS3Object(entry.key, options);
    await assertBackup(storage, plan, isCurrent);
    if (!sameBytes(object.bytes, entry.bytes)) throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
    onProgress?.({ phase: 'uploading', current: index + 1, total: plan.entries.length });
  }
}
/** Rechecking an uncertain backup is strictly read-only. */
export async function verifyTemplateMaterialBackup(
  storage: S3StorageControl,
  plan: TemplateMaterialBackupPlan,
  isCurrent: () => boolean
): Promise<void> {
  const options = plan.context ? { galleryContext: plan.context } : undefined;
  for (const entry of plan.entries) {
    await assertBackup(storage, plan, isCurrent);
    const object = await storage.getS3Object(entry.key, options);
    await assertBackup(storage, plan, isCurrent);
    if (!sameBytes(object.bytes, entry.bytes)) throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
  }
}
export async function readTemplateMaterialBackup(
  storage: S3StorageControl,
  key: string,
  isCurrent: () => boolean
): Promise<TemplateMaterialPackage | null> {
  assertTemplateMaterialCurrent(isCurrent);
  const configuration = await storage.s3StorageConfiguration();
  const assertion = { key, bytes: new Uint8Array(), configuration };
  await assertTemplateBackupContext(storage, assertion, isCurrent);
  const object = await storage.getS3Object(key);
  await assertTemplateBackupContext(storage, assertion, isCurrent);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(object.bytes)) as unknown;
  } catch {
    throw templateError('TEMPLATE_MATERIAL_INVALID');
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'kind') === 'oneVegetable.product-description-templates'
  )
    return null;
  const document = parseTemplateMaterialDocument(object.bytes);
  if (
    !key.endsWith('/templates.json') ||
    /[\\?#\p{Cc}]/u.test(key) ||
    key.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw templateError('TEMPLATE_MATERIAL_PATH_INVALID');
  const base = key.slice(0, -'templates.json'.length);
  const assets: TemplateMaterialPackage['assets'] = [];
  let totalBytes = object.bytes.length;
  for (const asset of document.assets) {
    await assertTemplateBackupContext(storage, assertion, isCurrent);
    const content = await storage.getS3Object(`${base}${asset.path}`);
    await assertTemplateBackupContext(storage, assertion, isCurrent);
    totalBytes += content.bytes.length;
    if (
      content.bytes.length !== asset.byteLength ||
      totalBytes > TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES ||
      (await galleryAssetSha256(content.bytes)) !== asset.sha256
    )
      throw templateError('TEMPLATE_MATERIAL_INVALID_IMAGE');
    assets.push({ path: asset.path, bytes: content.bytes });
  }
  const pack = { document, assets };
  await templateMaterialGalleryArchive(pack);
  assertTemplateMaterialCurrent(isCurrent);
  return pack;
}
