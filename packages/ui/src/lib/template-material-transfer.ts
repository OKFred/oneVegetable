import { watch } from 'vue';
import {
  decodeBase64,
  MAX_PHOTOBANK_IMAGE_BYTES,
  photoFileExtension,
  validatePhotoBytes,
  type ProductDescriptionTemplate
} from '@one-vegetable/core';
import {
  sameGalleryTransferContext,
  type GalleryTransferContext,
  type GalleryTransferTaskV1
} from '@one-vegetable/core/gallery-transfer-task';
import {
  encodeTemplateBundle,
  importTemplateBundle,
  listAllTemplates,
  parseTemplateBundle,
  templateError,
  type TemplateImportOutcome
} from '@one-vegetable/core/template-library';
import {
  parseTemplateMaterialDocument,
  templateImageSources,
  templateMaterialManifest,
  templateMaterialPath,
  templateMaterialResolvedBundle,
  templatesWithMaterialPaths,
  TEMPLATE_MATERIAL_MAX_ASSETS,
  TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES,
  type TemplateMaterialAsset,
  type TemplateMaterialPackage,
  type TemplateMaterialPhoto
} from '@one-vegetable/core/template-materials';
import { galleryAssetSha256 } from './gallery-transfer-archive';
import { allGalleryPhotos } from './gallery-transfer-driver';
import { galleryImportReadback } from './gallery-import-readback';
import { templateMaterialGalleryArchive } from './template-material-archive';
import type { GalleryTransferService } from './gallery-transfer-service';
import type { AppServices } from './services';

export interface TemplateMaterialProgress {
  phase: 'downloading' | 'uploading' | 'packing' | 'verifying';
  current: number;
  total: number;
}
export interface TemplateMaterialExportPlan {
  package: TemplateMaterialPackage;
  context: GalleryTransferContext | null;
}
export interface TemplateMaterialImportPlan {
  package: TemplateMaterialPackage;
  archiveBytes: Uint8Array | null;
  task: GalleryTransferTaskV1 | null;
  groupId: string;
  context: GalleryTransferContext | null;
  reuseExistingPhotos?: boolean;
}
const MATERIAL_IMPORT_CLAIM_LOCK = 'one-vegetable.template-material.import-claim.v1';
function matchingMaterialTasks(
  tasks: readonly GalleryTransferTaskV1[],
  sha: string | null,
  context: GalleryTransferContext,
  groupId: string
): GalleryTransferTaskV1[] {
  return tasks.filter(
    (task) =>
      task.direction === 'import' &&
      task.storage === 'zip' &&
      task.archiveSha256 === sha &&
      sameGalleryTransferContext(task.context, context) &&
      task.items.every((item) => item.kind === 'asset' && item.targetGroupId === groupId)
  );
}
export function assertTemplateMaterialCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw templateError('TEMPLATE_CONTEXT_CHANGED');
}
async function assertContext(
  services: AppServices,
  expected: GalleryTransferContext,
  isCurrent: () => boolean
): Promise<void> {
  assertTemplateMaterialCurrent(isCurrent);
  if (!services.gateway.galleryTransferContext) throw templateError('TEMPLATE_MATERIAL_UNAVAILABLE');
  const current = await services.gateway.galleryTransferContext();
  if (!sameGalleryTransferContext(current, expected)) throw templateError('TEMPLATE_CONTEXT_CHANGED');
  assertTemplateMaterialCurrent(isCurrent);
}

export async function prepareTemplateMaterialExport(
  services: AppServices,
  templates: readonly ProductDescriptionTemplate[],
  isCurrent: () => boolean,
  onProgress?: (value: TemplateMaterialProgress) => void
): Promise<TemplateMaterialExportPlan> {
  assertTemplateMaterialCurrent(isCurrent);
  // Inspect before HTML sanitization, so an unsupported image cannot disappear silently.
  const sources = templateImageSources(templates);
  if (sources.length > TEMPLATE_MATERIAL_MAX_ASSETS) throw templateError('TEMPLATE_MATERIAL_LIMIT');
  const bundle = parseTemplateBundle(encodeTemplateBundle(templates));
  const context = sources.length ? await services.gateway.galleryTransferContext?.() : null;
  if (sources.length && !context) throw templateError('TEMPLATE_MATERIAL_UNAVAILABLE');
  const replacements = new Map<string, string>();
  const metadata = new Map<string, TemplateMaterialAsset>();
  const assets: TemplateMaterialPackage['assets'] = [];
  let totalBytes = 0;
  onProgress?.({ phase: 'downloading', current: 0, total: sources.length });
  for (const [index, url] of sources.entries()) {
    if (!context) throw templateError('TEMPLATE_MATERIAL_UNAVAILABLE');
    await assertContext(services, context, isCurrent);
    const file = await services.gateway.request('downloadProductAsset', { url }, { galleryContext: context });
    await assertContext(services, context, isCurrent);
    const bytes = decodeBase64(file.contentBase64);
    if (!bytes.length || bytes.length > MAX_PHOTOBANK_IMAGE_BYTES || bytes.length !== file.byteLength)
      throw templateError('TEMPLATE_MATERIAL_INVALID_IMAGE');
    const contentType = validatePhotoBytes(bytes);
    if (
      (contentType !== 'image/jpeg' &&
        contentType !== 'image/png' &&
        contentType !== 'image/gif' &&
        contentType !== 'image/bmp') ||
      contentType !== file.contentType
    )
      throw templateError('TEMPLATE_MATERIAL_INVALID_IMAGE');
    const sha256 = await galleryAssetSha256(bytes);
    const extension = photoFileExtension(contentType);
    const path = templateMaterialPath(sha256, extension);
    replacements.set(url, path);
    if (!metadata.has(path)) {
      totalBytes += bytes.length;
      if (totalBytes > TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES)
        throw templateError('TEMPLATE_MATERIAL_LIMIT');
      metadata.set(path, {
        path,
        fileName: `image-${sha256.slice(0, 12)}.${extension}`,
        contentType,
        byteLength: bytes.length,
        sha256
      });
      assets.push({ path, bytes });
    }
    onProgress?.({ phase: 'downloading', current: index + 1, total: sources.length });
  }
  const document = {
    kind: 'oneVegetable.product-description-template-assets' as const,
    schemaVersion: 1 as const,
    exportedAtUtc: bundle.exportedAtUtc,
    templates: templatesWithMaterialPaths(bundle.templates, replacements),
    assets: [...metadata.values()]
  };
  const manifest = templateMaterialManifest(document);
  if (totalBytes + manifest.length > TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES)
    throw templateError('TEMPLATE_MATERIAL_LIMIT');
  assertTemplateMaterialCurrent(isCurrent);
  return { package: { document: parseTemplateMaterialDocument(manifest), assets }, context: context ?? null };
}

export async function prepareTemplateMaterialImport(
  transfers: GalleryTransferService | undefined,
  pack: TemplateMaterialPackage,
  groupId: string,
  groupName: string,
  isCurrent: () => boolean,
  reuseExistingPhotos = false
): Promise<TemplateMaterialImportPlan> {
  assertTemplateMaterialCurrent(isCurrent);
  // Codec verifies hashes, bytes, file headers and all referenced paths before preview.
  const archiveBytes = await templateMaterialGalleryArchive(pack);
  assertTemplateMaterialCurrent(isCurrent);
  if (!pack.document.assets.length)
    return { package: pack, archiveBytes: null, task: null, groupId, context: null };
  if (!transfers) throw templateError('TEMPLATE_MATERIAL_UNAVAILABLE');
  if (!groupId || groupId === '-1') throw templateError('TEMPLATE_MATERIAL_GROUP_REQUIRED');
  const context = await transfers.driver.context();
  const sha = await galleryAssetSha256(archiveBytes);
  const existing = matchingMaterialTasks(await transfers.repository.list(), sha, context, groupId);
  if (existing.length > 1) throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
  const task =
    existing[0] ??
    (await transfers.preview({
      direction: 'import',
      storage: 'zip',
      photos: [],
      groupId,
      groupName,
      archiveBytes,
      archiveName: 'one-vegetable-template-assets.zip',
      decisions: [],
      conflictPolicy: 'rename',
      createMissingGroups: false,
      importMapping: 'current',
      exportMapping: 'flat',
      exportPrefix: '',
      reuseExistingPhotos
    }));
  const after = await transfers.driver.context();
  if (!sameGalleryTransferContext(context, after) || !sameGalleryTransferContext(task.context, context))
    throw templateError('TEMPLATE_CONTEXT_CHANGED');
  assertTemplateMaterialCurrent(isCurrent);
  return { package: pack, archiveBytes, task, groupId, context, reuseExistingPhotos };
}

export async function executeTemplateMaterialImport(
  services: AppServices,
  transfers: GalleryTransferService | undefined,
  plan: TemplateMaterialImportPlan,
  conflict: 'skip' | 'copy',
  isCurrent: () => boolean,
  onProgress?: (value: TemplateMaterialProgress) => void
): Promise<TemplateImportOutcome[]> {
  assertTemplateMaterialCurrent(isCurrent);
  const client = services.productDescriptionTemplates;
  if (!client) throw templateError('TEMPLATE_MATERIAL_UNAVAILABLE');
  if (plan.context) await assertContext(services, plan.context, isCurrent);
  if (conflict === 'skip') {
    const existing = await listAllTemplates(client);
    assertTemplateMaterialCurrent(isCurrent);
    const key = (name: string, language: string) => `${language}:${name.trim().toLowerCase()}`;
    const names = new Set(existing.map((item) => key(item.name, item.language)));
    if (plan.package.document.templates.every((item) => names.has(key(item.name, item.language))))
      return plan.package.document.templates.map((item) => ({
        name: item.name,
        status: 'skipped',
        error: null
      }));
  }
  const photos = new Map<string, TemplateMaterialPhoto>();
  if (plan.task) {
    if (!transfers || !plan.archiveBytes || !plan.context)
      throw templateError('TEMPLATE_MATERIAL_UNAVAILABLE');
    if (!('locks' in navigator)) throw templateError('GALLERY_TASK_LOCK_UNAVAILABLE');
    const proposed = plan.task;
    const archiveBytes = plan.archiveBytes;
    const context = plan.context;
    // Recheck by content under a short cross-tab claim lock, not only by preview
    // task ID. Two stale previews must share any unknown write-ahead receipt.
    const claimed = await navigator.locks.request(MATERIAL_IMPORT_CLAIM_LOCK, async () => {
      await assertContext(services, context, isCurrent);
      const matches = matchingMaterialTasks(
        await transfers.repository.list(),
        proposed.archiveSha256,
        context,
        plan.groupId
      );
      if (matches.length > 1) throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
      const task = matches[0] ?? proposed;
      if (!matches.length) await transfers.create(task, archiveBytes, false);
      // Explicitly confirmed reconciliation policy: target/context/request IDs stay frozen.
      // No replacement task and no new upload for an already-sent receipt.
      if (plan.reuseExistingPhotos && !task.reuseExistingPhotos) {
        return transfers.repository.update(task.id, (current) => {
          current.reuseExistingPhotos = true;
        });
      }
      return task;
    });
    if (claimed.status !== 'completed') await transfers.driver.attachArchive(claimed, archiveBytes);
    await assertContext(services, plan.context, isCurrent);
    const stop = watch(transfers.tasks, (tasks) => {
      const task = tasks.find((value) => value.id === claimed.id);
      if (task)
        onProgress?.({
          phase: 'uploading',
          current: task.items.filter((item) => item.status === 'confirmed').length,
          total: task.items.length
        });
    });
    try {
      const current = await transfers.repository.get(claimed.id);
      if (current.status !== 'completed') {
        if (current.status === 'cancelled') throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
        // An unknown sent write can only be queried, never implicitly re-uploaded.
        const verifyOnly = current.items.some((item) =>
          ['unknown', 'unconfirmed', 'running'].includes(item.status)
        );
        await transfers.run(current.id, verifyOnly);
      }
    } finally {
      stop();
    }
    await assertContext(services, plan.context, isCurrent);
    const result = await transfers.repository.get(claimed.id);
    if (result.items.some((item) => item.errorCode === 'GALLERY_TASK_EXISTING_OTHER_GROUP'))
      throw templateError('TEMPLATE_MATERIAL_EXISTING_OTHER_GROUP');
    if (
      result.status !== 'completed' ||
      result.items.some((item) => item.status !== 'confirmed' || !item.fileId)
    )
      throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
    onProgress?.({ phase: 'verifying', current: 0, total: result.items.length });
    const found = await allGalleryPhotos(services.gateway, plan.groupId, { galleryContext: plan.context });
    await assertContext(services, plan.context, isCurrent);
    for (const item of result.items) {
      if (item.actualGroupId && item.actualGroupId !== plan.groupId && !plan.reuseExistingPhotos)
        throw templateError('TEMPLATE_MATERIAL_EXISTING_OTHER_GROUP');
      const photo = await galleryImportReadback(
        services.gateway,
        { ...result, reuseExistingPhotos: plan.reuseExistingPhotos === true },
        item,
        found
      );
      await assertContext(services, plan.context, isCurrent);
      if (!photo) throw templateError('TEMPLATE_MATERIAL_UNCONFIRMED');
      photos.set(item.sourcePath, { url: photo.url, fileId: photo.id });
    }
    onProgress?.({ phase: 'verifying', current: result.items.length, total: result.items.length });
  }
  assertTemplateMaterialCurrent(isCurrent);
  const bundle = templateMaterialResolvedBundle(plan.package.document, photos);
  return importTemplateBundle(
    {
      list: (input) => client.list(input),
      create: async (input) => {
        if (plan.context) await assertContext(services, plan.context, isCurrent);
        else assertTemplateMaterialCurrent(isCurrent);
        return client.create(input);
      },
      update: (input) => client.update(input),
      archive: (id, revision) => client.archive(id, revision),
      restore: (id, revision) => client.restore(id, revision)
    },
    bundle,
    conflict,
    undefined,
    isCurrent
  );
}
