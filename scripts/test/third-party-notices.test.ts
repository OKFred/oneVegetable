import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each(['apps/web/public', 'apps/extension/public'])(
  'bundles the pinned Three.js license in %s',
  async (directory) => {
    const [license, packaged] = await Promise.all([
      readFile(resolve('packages/ui/node_modules/three/LICENSE'), 'utf8'),
      readFile(resolve(directory, 'third-party/three.LICENSE.txt'), 'utf8')
    ]);
    const normalize = (text: string) => text.replaceAll('\r\n', '\n').trim();
    expect(normalize(packaged)).toBe(normalize(license));
  }
);
