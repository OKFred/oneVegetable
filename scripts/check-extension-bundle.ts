import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Manifest {
  background?: {
    service_worker?: string;
    type?: string;
  };
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
}

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'apps/extension/.output/chrome-mv3');
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8')) as Manifest;
const optionsHtml = await readFile(resolve(output, 'options.html'), 'utf8');
const files = await collectFiles(output);
const environmentText = await readFile(resolve(root, '.env'), 'utf8').catch(() => '');
const sensitiveValues = parseSensitiveEnvironmentValues(environmentText);
const sizes = await Promise.all(
  files.map(async (file) => ({
    file: file.slice(output.length + 1).replaceAll('\\', '/'),
    size: (await stat(file)).size
  }))
);
const largest = sizes.toSorted((left, right) => right.size - left.size).slice(0, 10);
const background = sizes.find((entry) => entry.file === 'background.js');
const eagerPageChunks = sizes.filter(
  (entry) => /^(chunks\/options-|chunks\/popup-)/.test(entry.file) && entry.file.endsWith('.js')
);
const eagerOptionFiles = [...optionsHtml.matchAll(/(?:src|href)="\/([^"?]+\.js)"/g)].flatMap((match) =>
  match[1] ? [match[1]] : []
);
const eagerOptionBytes = eagerOptionFiles.reduce(
  (total, file) => total + (sizes.find((entry) => entry.file === file)?.size ?? 0),
  0
);
const totalBytes = sizes.reduce((total, entry) => total + entry.size, 0);
const productTransferWorker = sizes.find((entry) =>
  /^assets\/product-transfer-archive\.worker-[A-Za-z0-9_-]+\.js$/u.test(entry.file)
);
const i18nChunk = sizes.find((entry) => /^chunks\/i18n-[A-Za-z0-9_-]+\.js$/u.test(entry.file));

const errors: string[] = [];
if (!background || background.size > 100_000) {
  errors.push(`background.js exceeds 100 KB: ${background?.size ?? 'missing'}`);
}
if (manifest.background?.service_worker !== 'background.js' || manifest.background.type !== 'module') {
  errors.push('MV3 background must remain an ESM service worker');
}
for (const chunk of eagerPageChunks) {
  if (chunk.size > 800_000) errors.push(`${chunk.file} exceeds the 800 KB eager-page budget: ${chunk.size}`);
}
if (eagerOptionBytes > 250_000) {
  errors.push(`Options eager JavaScript exceeds 250 KB: ${eagerOptionBytes}`);
}
if (!productTransferWorker || productTransferWorker.size > 50_000) {
  errors.push(`Product transfer worker exceeds 50 KB: ${productTransferWorker?.size ?? 'missing'}`);
}
if (!i18nChunk || i18nChunk.size > 300_000) {
  errors.push(`Bilingual i18n chunk exceeds 300 KB: ${i18nChunk?.size ?? 'missing'}`);
}
if (totalBytes > 4_000_000) errors.push(`Unpacked extension exceeds 4.00 MB: ${totalBytes}`);
if (sizes.some((entry) => entry.file.endsWith('.map'))) errors.push('Production source maps are not allowed');
if (manifest.permissions?.includes('cookies')) errors.push('cookies permission is not allowed');
if (manifest.host_permissions?.includes('<all_urls>'))
  errors.push('<all_urls> must not be a required host permission');
if (!manifest.host_permissions?.includes('https://eco.taobao.com/*')) {
  errors.push('The official HTTPS gateway host permission is missing');
}
for (const file of files) {
  const content = await readFile(file);
  const relativePath = file.slice(output.length + 1).replaceAll('\\', '/');
  for (const sensitive of sensitiveValues) {
    if (content.includes(Buffer.from(sensitive.value))) {
      errors.push(`${relativePath} contains the local ${sensitive.name} value`);
    }
  }
  if (/\.(?:css|html|js|json|txt)$/iu.test(file)) {
    const text = content.toString('utf8');
    if (/ALI_ACCOUNT|ALL_PASS/u.test(text)) {
      errors.push(`${relativePath} contains a local account environment variable name`);
    }
    if (/mock-[a-z0-9]|mock\.html|测试账号|test account|smoke test|真实账号验收/iu.test(text)) {
      errors.push(`${relativePath} contains internal fixture or account-validation text`);
    }
  }
}

process.stdout.write(
  `${largest.map((entry) => `${entry.file}\t${entry.size}`).join('\n')}\noptions eager JS\t${eagerOptionBytes}\nunpacked total\t${totalBytes}\n${sizes.length} extension files checked\n`
);
if (errors.length > 0) throw new Error(errors.join('\n'));

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    result.push(...(entry.isDirectory() ? await collectFiles(path) : [path]));
  }
  return result;
}

function parseSensitiveEnvironmentValues(
  source: string
): { name: 'ALI_ACCOUNT' | 'ALL_PASS'; value: string }[] {
  const result: { name: 'ALI_ACCOUNT' | 'ALL_PASS'; value: string }[] = [];
  const environmentEntryPattern = /^\s*(ALI_ACCOUNT|ALL_PASS)\s*=\s*(.*)$/u;
  for (const line of source.split(/\r?\n/u)) {
    const match = environmentEntryPattern.exec(line);
    if (!match?.[1] || match[2] === undefined) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/u, '').trim();
    }
    if (value.length >= 6) {
      result.push({ name: match[1] as 'ALI_ACCOUNT' | 'ALL_PASS', value });
    }
  }
  return result;
}
