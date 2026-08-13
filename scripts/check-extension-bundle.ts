import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Manifest {
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
}

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'apps/extension/.output/chrome-mv3');
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8')) as Manifest;
const optionsHtml = await readFile(resolve(output, 'options.html'), 'utf8');
const files = await collectFiles(output);
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

const errors: string[] = [];
if (!background || background.size > 1_800_000) {
  errors.push(`background.js exceeds 1.8 MB: ${background?.size ?? 'missing'}`);
}
for (const chunk of eagerPageChunks) {
  if (chunk.size > 800_000) errors.push(`${chunk.file} exceeds the 800 KB eager-page budget: ${chunk.size}`);
}
if (eagerOptionBytes > 250_000) {
  errors.push(`Options eager JavaScript exceeds 250 KB: ${eagerOptionBytes}`);
}
if (totalBytes > 3_200_000) errors.push(`Unpacked extension exceeds 3.2 MB: ${totalBytes}`);
if (sizes.some((entry) => entry.file.endsWith('.map'))) errors.push('Production source maps are not allowed');
if (manifest.permissions?.includes('cookies')) errors.push('cookies permission is not allowed');
if (manifest.host_permissions?.includes('<all_urls>'))
  errors.push('<all_urls> must not be a required host permission');
if (!manifest.host_permissions?.includes('https://eco.taobao.com/*')) {
  errors.push('The official HTTPS gateway host permission is missing');
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
