import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PUBLIC_AUTH_CALLBACK, PUBLIC_AUTH_ORIGIN } from '../packages/core/src/alibaba-iop';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'apps/auth-pages/dist');
const files = await readdir(dist);
for (const forbidden of ['_worker.js', 'functions']) {
  if (files.includes(forbidden)) throw new Error('Authorization Pages must remain purely static');
}
for (const required of ['index.html', 'callback.html', '404.html', '_headers']) {
  if (!files.includes(required)) throw new Error(`Missing static authorization asset: ${required}`);
}
const headers = await readFile(resolve(dist, '_headers'), 'utf8');
for (const required of [
  "connect-src 'none'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  'Referrer-Policy: no-referrer',
  'Cache-Control: no-store'
]) {
  if (!headers.includes(required)) throw new Error(`Missing authorization privacy header: ${required}`);
}
const config = await readFile(resolve(root, 'apps/auth-pages/wrangler.jsonc'), 'utf8');
if (/"(?:d1_databases|kv_namespaces|r2_buckets|secrets|vars|main)"/u.test(config))
  throw new Error('Static authorization site cannot have runtime bindings or secrets');
if (!config.includes('"pages_build_output_dir": "dist"'))
  throw new Error('Pages output must be relative to its independent project directory');
const manifest = await readFile(resolve(root, 'package.json'), 'utf8');
if (
  !manifest.includes('wrangler pages deploy dist --cwd=apps/auth-pages') ||
  /pages deploy[^"\n]*--config/u.test(manifest)
)
  throw new Error('Pages must use its own working directory, not an unsupported --config path');
if (
  new URL(PUBLIC_AUTH_CALLBACK).origin !== PUBLIC_AUTH_ORIGIN ||
  new URL(PUBLIC_AUTH_CALLBACK).pathname !== '/callback'
)
  throw new Error('Callback must use the canonical extensionless Pages URL');
for (const file of await readdir(resolve(dist, 'assets'))) {
  if (file.endsWith('.map')) throw new Error('Do not publish authorization source maps');
  if (!file.endsWith('.js')) continue;
  const source = await readFile(resolve(dist, 'assets', file), 'utf8');
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|type=["']password/u.test(source))
    throw new Error('Public authorization assets must not collect secrets or make API requests');
}
console.log('Static authorization assets, canonical callback and privacy headers verified');
