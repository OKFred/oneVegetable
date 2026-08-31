// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseProductTransferArchiveJson } from '@one-vegetable/core';

import {
  createProductTransferArchive,
  productTransferArchiveAssetPath,
  readProductTransferArchive
} from '../src/lib/product-transfer-archive';

const fixturePath = resolve(process.cwd(), 'mock/data/product-transfer/products-v2.json');
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('product transfer ZIP archive', () => {
  it('builds and reads a V2 archive with referenced assets', async () => {
    const document = parseProductTransferArchiveJson(await readFile(fixturePath, 'utf8'));
    const archive = await createProductTransferArchive({
      document,
      assets: [
        { path: 'assets/cover.jpg', fileName: 'cover.jpg', contentType: 'image/jpeg', bytes: jpeg },
        { path: 'assets/detail.png', fileName: 'detail.png', contentType: 'image/png', bytes: png }
      ]
    });

    const result = await readProductTransferArchive(archive);
    expect(result.document.products).toHaveLength(1);
    expect(result.assets.map((asset) => asset.path)).toEqual(['assets/cover.jpg', 'assets/detail.png']);
    expect(result.referencedAssetPaths).toEqual(['assets/cover.jpg', 'assets/detail.png']);
    expect(result.unusedAssetPaths).toEqual([]);
  });

  it('rejects missing, forged and unsafe archive resources', async () => {
    const manifest = await readFile(fixturePath);
    await expect(
      readProductTransferArchive(zipSync({ 'products.json': manifest, 'assets/cover.jpg': jpeg }))
    ).rejects.toThrow('缺少引用图片');
    await expect(
      readProductTransferArchive(
        zipSync({ 'products.json': manifest, 'assets/cover.jpg': jpeg, 'assets/detail.png': jpeg })
      )
    ).rejects.toThrow('扩展名与文件内容不一致');
    await expect(
      readProductTransferArchive(zipSync({ 'products.json': manifest, '../outside.jpg': jpeg }))
    ).rejects.toThrow(/不安全路径|路径穿越/u);
  });

  it('reports unused assets and creates deterministic safe names', async () => {
    const document = parseProductTransferArchiveJson(await readFile(fixturePath, 'utf8'));
    const archive = zipSync({
      'products.json': new TextEncoder().encode(JSON.stringify(document)),
      'assets/cover.jpg': jpeg,
      'assets/detail.png': png,
      'assets/unused.jpg': jpeg
    });
    const result = await readProductTransferArchive(archive);
    expect(result.unusedAssetPaths).toEqual(['assets/unused.jpg']);
    expect(
      productTransferArchiveAssetPath(
        'My cover 01.jpeg',
        'image/jpeg',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      )
    ).toBe('assets/My-cover-01-0123456789ab.jpg');
  });
});
