import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveLocalCredentialEncryptionKey } from '../lib/local-credential-encryption-key';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe('local credential encryption key', () => {
  it('uses an explicit environment key without creating a local file', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'nested', 'credential-key');
    const configuredValue = encodedKey(7);

    await expect(resolveLocalCredentialEncryptionKey({ configuredValue, filePath })).resolves.toEqual({
      value: configuredValue,
      source: 'environment',
      filePath: null
    });
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('generates one ignored local key and reuses it on later starts', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, '.data', 'credential-key');

    const first = await resolveLocalCredentialEncryptionKey({ configuredValue: undefined, filePath });
    const second = await resolveLocalCredentialEncryptionKey({ configuredValue: undefined, filePath });

    expect(first).toMatchObject({ source: 'generated', filePath });
    expect(second).toEqual({ value: first.value, source: 'local-file', filePath });
    expect((await readFile(filePath, 'utf8')).trim()).toBe(first.value);
    expect(Buffer.from(first.value, 'base64url')).toHaveLength(32);
  });

  it('converges on one key when two local starts race', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, '.data', 'credential-key');

    const [first, second] = await Promise.all([
      resolveLocalCredentialEncryptionKey({ configuredValue: undefined, filePath }),
      resolveLocalCredentialEncryptionKey({ configuredValue: undefined, filePath })
    ]);

    expect(first.value).toBe(second.value);
    expect(new Set([first.source, second.source])).toEqual(new Set(['generated', 'local-file']));
  });

  it('rejects a malformed persisted key instead of silently replacing it', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'credential-key');
    await writeFile(filePath, 'not-a-key\n', 'utf8');

    await expect(
      resolveLocalCredentialEncryptionKey({ configuredValue: undefined, filePath })
    ).rejects.toThrow('32 字节 Base64URL');
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'one-vegetable-credential-key-'));
  temporaryDirectories.push(directory);
  return directory;
}

function encodedKey(fill: number): string {
  return Buffer.alloc(32, fill).toString('base64url');
}
