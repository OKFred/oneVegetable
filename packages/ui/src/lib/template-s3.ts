import { encodeTemplateBundle, templateError } from '@one-vegetable/core/template-library';
import type { ProductDescriptionTemplate } from '@one-vegetable/core';
import type { S3StorageConfigurationSummary, S3StorageControl } from '@one-vegetable/core/s3-storage';

export interface TemplateBackupPlan {
  key: string;
  bytes: Uint8Array;
  configuration: S3StorageConfigurationSummary;
}

export async function prepareTemplateBackup(
  storage: S3StorageControl,
  templates: readonly ProductDescriptionTemplate[],
  prefix: string
): Promise<TemplateBackupPlan> {
  const path = prefix.trim().replace(/\/$/u, '');
  if (
    !path ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[\\?#]/u.test(path) ||
    Array.from(path).some((char) => char.charCodeAt(0) < 32)
  )
    throw templateError('TEMPLATE_PREFIX_INVALID');
  const configuration = await storage.s3StorageConfiguration();
  if (!configuration.configured) throw templateError('S3_NOT_CONFIGURED');
  return {
    key: `${path}/${crypto.randomUUID()}/templates.json`,
    bytes: encodeTemplateBundle(templates),
    configuration
  };
}

export async function assertTemplateBackupContext(
  storage: S3StorageControl,
  plan: TemplateBackupPlan,
  isCurrent: () => boolean
): Promise<void> {
  if (!isCurrent()) throw templateError('TEMPLATE_CONTEXT_CHANGED');
  const current = await storage.s3StorageConfiguration();
  if (
    !isCurrent() ||
    !current.configured ||
    ['revision', 'endpoint', 'bucket', 'rootPrefix'].some(
      (key) => Reflect.get(current, key) !== Reflect.get(plan.configuration, key)
    )
  )
    throw templateError('TEMPLATE_CONTEXT_CHANGED');
}

export async function verifyTemplateBackup(
  storage: S3StorageControl,
  plan: TemplateBackupPlan,
  isCurrent: () => boolean
): Promise<void> {
  await assertTemplateBackupContext(storage, plan, isCurrent);
  const object = await storage.getS3Object(plan.key);
  if (!isCurrent()) throw templateError('TEMPLATE_CONTEXT_CHANGED');
  if (
    object.bytes.length !== plan.bytes.length ||
    !object.bytes.every((byte, index) => byte === plan.bytes[index])
  )
    throw templateError('TEMPLATE_BACKUP_UNCONFIRMED');
}
