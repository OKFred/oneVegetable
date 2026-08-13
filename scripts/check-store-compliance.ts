import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Manifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  description?: string;
  default_locale?: string;
  homepage_url?: string;
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
  submissionStatus?: { realMutationsEnabled?: boolean };
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
const privacyPolicy = await readFile(resolve(root, 'docs/privacy-policy.md'), 'utf8');
const errors: string[] = [];

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (manifest.name !== '__MSG_extName__') errors.push('manifest name must use __MSG_extName__');
if (manifest.description !== '__MSG_extDescription__')
  errors.push('manifest description must use __MSG_extDescription__');
if (manifest.default_locale !== 'zh_CN') errors.push('default_locale must be zh_CN');
if (manifest.homepage_url !== listing.homepageUrl) errors.push('manifest and listing homepage URLs differ');
if (manifest.version !== listing.extensionVersion) errors.push('manifest and listing versions differ');
if (JSON.stringify(manifest.permissions) !== JSON.stringify(['storage']))
  errors.push('required extension permissions must remain exactly [storage]');
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
if (listing.permissions?.length !== 3) errors.push('store permission inventory must contain three entries');
if (listing.submissionStatus?.realMutationsEnabled !== false)
  errors.push('real mutations must remain disabled before account smoke tests');

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
  ['docs/privacy-policy.md', privacyPolicy]
] as const) {
  for (const phrase of ['chrome.storage.local', 'chrome.storage.session', 'Limited Use', '真实写']) {
    if (!content.includes(phrase)) errors.push(`${file} is missing disclosure phrase: ${phrase}`);
  }
}

process.stdout.write(`MV3 manifest, 2 locales, 3 permission declarations and privacy disclosures checked\n`);
if (errors.length > 0) throw new Error(errors.join('\n'));

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
