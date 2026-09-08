export const GALLERY_TRANSFER_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const GALLERY_TRANSFER_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const GALLERY_TRANSFER_MAX_ENTRIES = 500;
export const GALLERY_TRANSFER_ASSET_DIRECTORY = 'assets/';
export const GALLERY_IMPORT_RULE_LIMIT = 50;

export type GalleryTransferConflictPolicy = 'skip' | 'rename';

export interface GalleryImportRule {
  id: string;
  name: string;
  enabled: boolean;
  sourcePrefix: string;
  includeGlob: string;
  excludeGlobs: string[];
  targetGroupPath: string;
}

export interface GalleryImportRuleSet {
  schemaVersion: 1;
  conflictPolicy: GalleryTransferConflictPolicy;
  rules: GalleryImportRule[];
}

export interface GalleryImportCandidate {
  sourcePath: string;
  fileName: string;
  byteLength: number | null;
  contentType: string | null;
}

export interface GalleryImportDecision extends GalleryImportCandidate {
  action: 'import' | 'skip';
  matchedRuleId: string | null;
  targetGroupPath: string | null;
  reason: 'matched' | 'excluded' | 'unmatched';
}

export interface GalleryTransferAssetV1 {
  path: string;
  fileName: string;
  sourcePhotoId: string;
  groupPath: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  width: number | null;
  height: number | null;
  modifiedTimeUtc: number | null;
}

export interface GalleryTransferDocumentV1 {
  schemaVersion: 1;
  kind: 'one-vegetable-gallery-transfer';
  createdTimeUtc: number;
  assets: GalleryTransferAssetV1[];
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/bmp']);

export function validateGalleryImportRuleSet(value: unknown): GalleryImportRuleSet {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.rules)) {
    throw new Error('图库导入规则格式无效');
  }
  if (value.rules.length > GALLERY_IMPORT_RULE_LIMIT) {
    throw new Error(`图库导入规则不能超过 ${GALLERY_IMPORT_RULE_LIMIT} 条`);
  }
  const conflictPolicy = value.conflictPolicy;
  if (conflictPolicy !== 'skip' && conflictPolicy !== 'rename') {
    throw new Error('图库导入冲突策略无效');
  }
  const ids = new Set<string>();
  const rules = value.rules.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`第 ${index + 1} 条图库导入规则格式无效`);
    const id = requiredText(candidate.id, `第 ${index + 1} 条规则 ID`);
    if (!SAFE_ID.test(id) || ids.has(id)) throw new Error(`第 ${index + 1} 条规则 ID 无效或重复`);
    ids.add(id);
    const includeGlob = normalizeGlob(requiredText(candidate.includeGlob, `第 ${index + 1} 条包含规则`));
    const sourcePrefix = normalizeOptionalPath(candidate.sourcePrefix, `第 ${index + 1} 条来源前缀`);
    const targetGroupPath = normalizeRequiredPath(candidate.targetGroupPath, `第 ${index + 1} 条目标分组`);
    if (!Array.isArray(candidate.excludeGlobs)) {
      throw new Error(`第 ${index + 1} 条排除规则必须是数组`);
    }
    return {
      id,
      name: requiredText(candidate.name, `第 ${index + 1} 条规则名称`).slice(0, 80),
      enabled: candidate.enabled === true,
      sourcePrefix,
      includeGlob,
      excludeGlobs: candidate.excludeGlobs.map((glob) => normalizeGlob(requiredText(glob, '排除规则'))),
      targetGroupPath
    };
  });
  return { schemaVersion: 1, conflictPolicy, rules };
}

export function evaluateGalleryImportRules(
  candidates: readonly GalleryImportCandidate[],
  ruleSet: GalleryImportRuleSet
): GalleryImportDecision[] {
  const validated = validateGalleryImportRuleSet(ruleSet);
  return candidates.map((candidate) => evaluateCandidate(candidate, validated.rules));
}

export function validateGalleryTransferDocument(value: unknown): GalleryTransferDocumentV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'one-vegetable-gallery-transfer' ||
    !Number.isSafeInteger(value.createdTimeUtc) ||
    !Array.isArray(value.assets)
  ) {
    throw new Error('图库传输清单格式无效');
  }
  const paths = new Set<string>();
  const assets = value.assets.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`图库资源 ${index + 1} 格式无效`);
    const path = normalizeAssetPath(candidate.path);
    if (paths.has(path)) throw new Error(`图库资源路径重复：${path}`);
    paths.add(path);
    const contentType = requiredText(candidate.contentType, '图库资源 Content-Type').toLocaleLowerCase();
    if (!SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType))
      throw new Error(`图库资源格式不受支持：${contentType}`);
    const byteLength = nonNegativeInteger(candidate.byteLength, '图库资源大小');
    const sha256 = requiredText(candidate.sha256, '图库资源 SHA-256').toLocaleLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error('图库资源 SHA-256 无效');
    return {
      path,
      fileName: safeFileName(requiredText(candidate.fileName, '图库资源文件名')),
      sourcePhotoId: requiredText(candidate.sourcePhotoId, '图库资源来源 ID'),
      groupPath: normalizeRequiredPath(candidate.groupPath, '图库资源分组路径'),
      contentType,
      byteLength,
      sha256,
      width: nullableNonNegativeInteger(candidate.width, '图库资源宽度'),
      height: nullableNonNegativeInteger(candidate.height, '图库资源高度'),
      modifiedTimeUtc: nullableNonNegativeInteger(candidate.modifiedTimeUtc, '图库资源更新时间')
    };
  });
  return {
    schemaVersion: 1,
    kind: 'one-vegetable-gallery-transfer',
    createdTimeUtc: value.createdTimeUtc as number,
    assets
  };
}

function evaluateCandidate(
  candidate: GalleryImportCandidate,
  rules: readonly GalleryImportRule[]
): GalleryImportDecision {
  const sourcePath = normalizeRequiredPath(candidate.sourcePath, '图库导入来源路径');
  const normalizedCandidate = { ...candidate, sourcePath };
  for (const rule of rules) {
    if (!rule.enabled || !isWithinPrefix(sourcePath, rule.sourcePrefix)) continue;
    const relativePath = rule.sourcePrefix
      ? sourcePath.slice(rule.sourcePrefix.length).replace(/^\//u, '')
      : sourcePath;
    if (!globMatches(relativePath, rule.includeGlob)) continue;
    if (rule.excludeGlobs.some((glob) => globMatches(relativePath, glob))) {
      return {
        ...normalizedCandidate,
        action: 'skip',
        matchedRuleId: rule.id,
        targetGroupPath: null,
        reason: 'excluded'
      };
    }
    return {
      ...normalizedCandidate,
      action: 'import',
      matchedRuleId: rule.id,
      targetGroupPath: rule.targetGroupPath,
      reason: 'matched'
    };
  }
  return {
    ...normalizedCandidate,
    action: 'skip',
    matchedRuleId: null,
    targetGroupPath: null,
    reason: 'unmatched'
  };
}

function globMatches(path: string, glob: string): boolean {
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? '';
    const next = glob[index + 1];
    if (character === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`${source}$`, 'iu').test(path);
}

function isWithinPrefix(path: string, prefix: string): boolean {
  return prefix === '' || path === prefix || path.startsWith(`${prefix}/`);
}

function normalizeGlob(value: string): string {
  const glob = value.trim().replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!glob || glob.startsWith('/') || glob.includes('\0') || glob.split('/').includes('..')) {
    throw new Error('图库导入 Glob 无效');
  }
  return glob;
}

function normalizeAssetPath(value: unknown): string {
  const path = normalizeRequiredPath(value, '图库资源路径');
  if (!path.startsWith(GALLERY_TRANSFER_ASSET_DIRECTORY)) {
    throw new Error(`图库资源必须放在 ${GALLERY_TRANSFER_ASSET_DIRECTORY} 目录`);
  }
  return path;
}

function normalizeRequiredPath(value: unknown, label: string): string {
  const path = normalizeOptionalPath(value, label);
  if (!path) throw new Error(`${label}不能为空`);
  return path;
}

function normalizeOptionalPath(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`);
  const path = value.trim().replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (path.startsWith('/') || path.includes('\0') || path.split('/').some((part) => part === '..')) {
    throw new Error(`${label}包含不安全路径`);
  }
  return path;
}

function safeFileName(value: string): string {
  if (
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error('图库资源文件名无效');
  }
  return value.slice(0, 255);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`);
  return value.trim();
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label}无效`);
  return value as number;
}

function nullableNonNegativeInteger(value: unknown, label: string): number | null {
  return value === null ? null : nonNegativeInteger(value, label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
