import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Manifest {
  background?: {
    service_worker?: string;
    type?: string;
  };
  manifest_version?: number;
  name?: string;
  version?: string;
  description?: string;
  default_locale?: string;
  homepage_url?: string;
  minimum_chrome_version?: string;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
}

interface Listing {
  extensionVersion?: string;
  singlePurpose?: string;
  privacyPolicyUrl?: string;
  supportUrl?: string;
  homepageUrl?: string;
  permissions?: { permission?: string; justification?: string }[];
  submissionStatus?: {
    enabledRealMutations?: string[];
    otherRealMutationsEnabled?: boolean;
  };
}

interface LocaleMessages {
  extName?: { message?: string };
  extDescription?: { message?: string };
}

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'apps/extension/.output/chrome-mv3');
const manifest = await readJson<Manifest>(resolve(output, 'manifest.json'));
const listing = await readJson<Listing>(resolve(root, 'store-listing/listing.json'));
const privacyHtml = await readFile(resolve(output, 'privacy.html'), 'utf8');
const privacyEnglishHtml = await readFile(resolve(output, 'privacy-en.html'), 'utf8');
const privacyPolicy = await readFile(resolve(root, 'docs/privacy-policy.md'), 'utf8');
const privacyEnglishPolicy = await readFile(resolve(root, 'docs/privacy-policy.en.md'), 'utf8');
const zhListing = await readFile(resolve(root, 'store-listing/zh_CN.md'), 'utf8');
const enListing = await readFile(resolve(root, 'store-listing/en.md'), 'utf8');
const credentialVaultSource = await readFile(resolve(root, 'packages/core/src/credential-vault.ts'), 'utf8');
const backgroundSource = await readFile(resolve(root, 'apps/extension/entrypoints/background.ts'), 'utf8');
const storeIcon = await readFile(resolve(root, 'store-listing/assets/icon-128.png'));
const screenshotDirectory = resolve(root, 'store-listing/assets/screenshots');
const screenshots = (await readdir(screenshotDirectory))
  .filter((file) => file.endsWith('.png'))
  .toSorted((left, right) => left.localeCompare(right));
const errors: string[] = [];

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (manifest.background?.service_worker !== 'background.js' || manifest.background.type !== 'module') {
  errors.push('manifest background must remain an ESM service worker');
}
if (manifest.name !== '__MSG_extName__') errors.push('manifest name must use __MSG_extName__');
if (manifest.description !== '__MSG_extDescription__')
  errors.push('manifest description must use __MSG_extDescription__');
if (manifest.default_locale !== 'zh_CN') errors.push('default_locale must be zh_CN');
if (manifest.minimum_chrome_version !== '102') {
  errors.push('minimum_chrome_version must remain 102 for storage access-level enforcement');
}
if (manifest.homepage_url !== listing.homepageUrl) errors.push('manifest and listing homepage URLs differ');
if (manifest.version !== listing.extensionVersion) errors.push('manifest and listing versions differ');
if (JSON.stringify(manifest.permissions) !== JSON.stringify(['storage', 'scripting']))
  errors.push('required extension permissions must remain exactly [storage, scripting]');
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://eco.taobao.com/*']))
  errors.push('required host permissions must remain limited to the official gateway');
if (JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(['http://*/*', 'https://*/*'])) {
  errors.push('optional host permissions changed without updating the reviewed disclosure');
}
if (!listing.singlePurpose || listing.singlePurpose.length < 60)
  errors.push('store listing single purpose is missing or too vague');
for (const field of ['privacyPolicyUrl', 'supportUrl', 'homepageUrl'] as const) {
  const value = listing[field];
  if (!value?.startsWith('https://') || /placeholder|example\.com/iu.test(value)) {
    errors.push(`${field} must be a non-placeholder HTTPS URL`);
  }
}
if ((listing.permissions ?? []).some((permission) => !permission.justification?.trim())) {
  errors.push('every store permission declaration needs a justification');
}
if (listing.permissions?.length !== 4) errors.push('store permission inventory must contain four entries');
const enabledRealMutations = listing.submissionStatus?.enabledRealMutations ?? [];
if (
  JSON.stringify(enabledRealMutations) !==
  JSON.stringify(['operatePhotoGroup', 'uploadPhoto', 'transferPhotoFromUrl'])
) {
  errors.push('store listing must disclose the exact reviewed gallery mutation set');
}
if (listing.submissionStatus?.otherRealMutationsEnabled !== false) {
  errors.push('unreviewed real mutations must remain disabled');
}
if (screenshots.length < 1 || screenshots.length > 5)
  errors.push('store listing must contain between one and five screenshots');
for (const screenshot of screenshots) {
  const dimensions = pngDimensions(await readFile(resolve(screenshotDirectory, screenshot)));
  if (dimensions.width !== 1280 || dimensions.height !== 800) {
    errors.push(`${screenshot} must be exactly 1280x800`);
  }
}
const iconDimensions = pngDimensions(storeIcon);
if (iconDimensions.width !== 128 || iconDimensions.height !== 128)
  errors.push('store icon must be exactly 128x128');

for (const locale of ['zh_CN', 'en']) {
  const messages = await readJson<LocaleMessages>(resolve(output, `_locales/${locale}/messages.json`));
  const name = messages.extName?.message ?? '';
  const description = messages.extDescription?.message ?? '';
  if (!name) errors.push(`${locale} extension name is missing`);
  if (!description || description.length > 132)
    errors.push(`${locale} extension description must contain 1-132 characters`);
}

for (const [file, content] of [
  ['privacy.html', privacyHtml],
  ['privacy-en.html', privacyEnglishHtml],
  ['docs/privacy-policy.md', privacyPolicy],
  ['docs/privacy-policy.en.md', privacyEnglishPolicy],
  ['store-listing/zh_CN.md', zhListing],
  ['store-listing/en.md', enListing]
] as const) {
  if (/\bmock\b|测试账号|test account|smoke test|真实账号验收/iu.test(content)) {
    errors.push(`${file} contains internal test or demonstration terminology`);
  }
}

for (const [file, content, language, canonical] of [
  [
    'privacy.html',
    privacyHtml,
    'zh-CN',
    'https://github.com/OKFred/oneVegetable/blob/master/docs/privacy-policy.md'
  ],
  [
    'privacy-en.html',
    privacyEnglishHtml,
    'en',
    'https://github.com/OKFred/oneVegetable/blob/master/docs/privacy-policy.en.md'
  ]
] as const) {
  if (!content.includes(`<html lang="${language}">`)) errors.push(`${file} is missing its language metadata`);
  if (!content.includes(`<link rel="canonical" href="${canonical}">`)) {
    errors.push(`${file} is missing its canonical URL`);
  }
  if (!content.includes('Content-Security-Policy') || !content.includes("default-src 'none'")) {
    errors.push(`${file} is missing a restrictive CSP`);
  }
  if (!content.includes('hreflang="zh-CN"') || !content.includes('hreflang="en"')) {
    errors.push(`${file} is missing bilingual alternate links`);
  }
  if (/<script\b|\son[a-z]+\s*=|javascript:/iu.test(content)) {
    errors.push(`${file} must remain a script-free static page`);
  }
}

for (const [file, content] of [
  ['privacy.html', privacyHtml],
  ['docs/privacy-policy.md', privacyPolicy]
] as const) {
  for (const phrase of [
    'chrome.storage.local',
    'chrome.storage.session',
    'Limited Use',
    'PBKDF2-HMAC-SHA256',
    'AES-256-GCM',
    'TRUSTED_CONTEXTS',
    '口令不保存',
    '自动锁定',
    '真实写'
  ]) {
    if (!content.includes(phrase)) errors.push(`${file} is missing disclosure phrase: ${phrase}`);
  }
}

for (const [file, content] of [
  ['privacy-en.html', privacyEnglishHtml],
  ['docs/privacy-policy.en.md', privacyEnglishPolicy]
] as const) {
  for (const phrase of [
    'chrome.storage.local',
    'chrome.storage.session',
    'Limited Use',
    'PBKDF2-HMAC-SHA256',
    'AES-256-GCM',
    'TRUSTED_CONTEXTS',
    'passphrase is not stored',
    'automatically locks',
    'real write'
  ]) {
    if (!content.includes(phrase)) errors.push(`${file} is missing disclosure phrase: ${phrase}`);
  }
}

for (const phrase of [
  "browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })",
  "browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })"
]) {
  if (!backgroundSource.includes(phrase)) {
    errors.push(`background is missing reviewed storage isolation: ${phrase}`);
  }
}

for (const phrase of [
  'CREDENTIAL_VAULT_ITERATIONS = 600_000',
  "format: 'PBKDF2-HMAC-SHA256/AES-256-GCM'",
  "name: 'AES-GCM'",
  'KEY_EXTRACTABLE = false'
]) {
  if (!credentialVaultSource.includes(phrase)) {
    errors.push(`credential vault source is missing reviewed security setting: ${phrase}`);
  }
}

process.stdout.write(
  `MV3 manifest, 2 locales, bilingual static privacy disclosures, 4 permission declarations and ${screenshots.length} screenshots checked\n`
);
if (errors.length > 0) throw new Error(errors.join('\n'));

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function pngDimensions(value: Buffer): { width: number; height: number } {
  const pngSignature = '89504e470d0a1a0a';
  if (value.length < 24 || value.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('Store asset is not a valid PNG file');
  }
  return { width: value.readUInt32BE(16), height: value.readUInt32BE(20) };
}
