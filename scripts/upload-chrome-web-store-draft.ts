import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ChromeWebStoreDraftClient,
  chromeWebStoreAccessTokenFromEnvironment,
  chromeWebStoreTargetFromEnvironment,
  parseExtensionReleaseManifest
} from './lib/chrome-web-store';
import { writeTextFileWithRetry } from './lib/safe-write';

const root = resolve(import.meta.dirname, '..');
const artifactsDirectory = resolve(root, 'artifacts');
const releaseManifest = parseExtensionReleaseManifest(
  JSON.parse(await readFile(resolve(artifactsDirectory, 'release.json'), 'utf8'))
);
const archive = await readFile(resolve(artifactsDirectory, releaseManifest.artifact));
const actualSha256 = createHash('sha256').update(archive).digest('hex');
if (archive.byteLength !== releaseManifest.size || actualSha256 !== releaseManifest.sha256) {
  throw new Error('Release ZIP does not match artifacts/release.json; run pnpm release:extension again.');
}

const target = chromeWebStoreTargetFromEnvironment(process.env);
const confirmed = process.argv.includes('--confirm-draft-upload');
if (!confirmed) {
  process.stdout.write(
    `Draft upload preflight passed for ${releaseManifest.artifact}.\nNo network request was sent. Re-run with --confirm-draft-upload to upload this package as a store draft.\n`
  );
} else {
  const accessToken = chromeWebStoreAccessTokenFromEnvironment(process.env);
  const client = new ChromeWebStoreDraftClient(target, accessToken);
  const result = await client.upload(archive, releaseManifest.extensionVersion);
  const report = {
    schemaVersion: 1,
    action: 'draft-upload',
    uploadedAtUtc: new Date().toISOString(),
    publisherId: target.publisherId,
    itemId: target.itemId,
    extensionVersion: releaseManifest.extensionVersion,
    artifact: releaseManifest.artifact,
    sha256: releaseManifest.sha256,
    uploadState: result.uploadState,
    pollAttempts: result.pollAttempts,
    publishCalled: false
  };
  await writeTextFileWithRetry(
    resolve(artifactsDirectory, 'chrome-web-store-draft-upload.json'),
    `${JSON.stringify(report, null, 2)}\n`
  );
  process.stdout.write(
    `Chrome Web Store draft upload succeeded for version ${releaseManifest.extensionVersion}.\nNo publish or review submission request was sent.\n`
  );
}
