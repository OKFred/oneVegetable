import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicWriteJson } from '../openapi-auth/storage';

const directories: string[] = [];
const prefix = 'one-vegetable-atomic-json-';
const oldContents = '{"old":"unchanged"}\n';
const nextValue = { next: 'offline fixture' };
const nextContents = `${JSON.stringify(nextValue, null, 2)}\n`;

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    // Exact test-owned mkdtemp directory only; never a supplied path or broad temp root.
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(prefix))
      throw new Error('UNSAFE_TEST_CLEANUP_PATH');
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(resolve(tmpdir()), prefix));
  directories.push(directory);
  const target = join(directory, 'journal.json');
  await writeFile(target, oldContents);
  const sleep = vi.fn((_milliseconds: number) => Promise.resolve());
  return { directory, target, sleep };
}

function failure(code: string) {
  return Object.assign(new Error('offline rename error'), { code });
}

describe('atomic JSON Windows rename retry boundary', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'retries only the SAME rename for %s, up to four waits',
    async (code) => {
      const f = await fixture();
      const replace = vi.fn(async (source: string, target: string) => {
        expect(await readFile(target, 'utf8')).toBe(oldContents);
        expect(await readFile(source, 'utf8')).toBe(nextContents);
        if (replace.mock.calls.length <= 4) throw failure(code);
        await rename(source, target);
      });
      await atomicWriteJson(f.target, nextValue, { platform: 'win32', rename: replace, sleep: f.sleep });
      expect(replace).toHaveBeenCalledTimes(5);
      expect(new Set(replace.mock.calls.map(([source]) => source)).size).toBe(1);
      expect(replace.mock.calls.every(([, target]) => target === f.target)).toBe(true);
      expect(f.sleep.mock.calls).toEqual([[50], [100], [200], [400]]);
      expect(await readFile(f.target, 'utf8')).toBe(nextContents);
      expect(await readdir(f.directory)).toEqual(['journal.json']);
    }
  );

  it('successful first rename has no wait', async () => {
    const f = await fixture();
    await atomicWriteJson(f.target, nextValue, { platform: 'win32', sleep: f.sleep });
    expect(f.sleep).not.toHaveBeenCalled();
    expect(await readFile(f.target, 'utf8')).toBe(nextContents);
    expect(await readdir(f.directory)).toEqual(['journal.json']);
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'exhausted %s preserves target and cleans only owned temp',
    async (code) => {
      const f = await fixture();
      const unrelated = join(f.directory, 'journal.json.someone-else.tmp');
      await writeFile(unrelated, 'unrelated');
      const error = failure(code);
      const replace = vi.fn((_source: string, _target: string) => Promise.reject(error));
      await expect(
        atomicWriteJson(f.target, nextValue, {
          platform: 'win32',
          rename: replace,
          sleep: f.sleep
        })
      ).rejects.toBe(error);
      expect(replace).toHaveBeenCalledTimes(5);
      expect(new Set(replace.mock.calls.map(([source]) => source)).size).toBe(1);
      expect(f.sleep.mock.calls).toEqual([[50], [100], [200], [400]]);
      expect(await readFile(f.target, 'utf8')).toBe(oldContents);
      expect(await readFile(unrelated, 'utf8')).toBe('unrelated');
      expect((await readdir(f.directory)).sort()).toEqual(['journal.json', 'journal.json.someone-else.tmp']);
    }
  );

  it.each([
    ['linux', 'EPERM'],
    ['linux', 'EACCES'],
    ['linux', 'EBUSY'],
    ['darwin', 'EPERM'],
    ['win32', 'ENOSPC'],
    ['win32', 'EIO'],
    ['win32', 'ENOENT'],
    ['win32', 'EXDEV'],
    ['win32', 'EPERM_NOT_AN_ERRNO']
  ] as const)('does not retry %s / %s and preserves target', async (platform, code) => {
    const f = await fixture();
    const error = failure(code);
    const replace = vi.fn(() => Promise.reject(error));
    await expect(
      atomicWriteJson(f.target, nextValue, {
        platform,
        rename: replace,
        sleep: f.sleep
      })
    ).rejects.toBe(error);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(f.sleep).not.toHaveBeenCalled();
    expect(await readFile(f.target, 'utf8')).toBe(oldContents);
    expect(await readdir(f.directory)).toEqual(['journal.json']);
  });

  it('stops immediately on a permanent second error and propagates that exact error', async () => {
    const f = await fixture();
    const error = failure('ENOSPC');
    const replace = vi.fn().mockRejectedValueOnce(failure('EPERM')).mockRejectedValue(error);
    await expect(
      atomicWriteJson(f.target, nextValue, {
        platform: 'win32',
        rename: replace,
        sleep: f.sleep
      })
    ).rejects.toBe(error);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(f.sleep.mock.calls).toEqual([[50]]);
    expect(await readFile(f.target, 'utf8')).toBe(oldContents);
    expect(await readdir(f.directory)).toEqual(['journal.json']);
  });

  it('cleanup failure cannot replace the original error or delete the old target', async () => {
    const f = await fixture();
    const error = failure('EIO');
    const replace = vi.fn((_source: string, _target: string) => Promise.reject(error));
    const cleanup = vi.fn((_path: string) => Promise.reject(failure('EACCES')));
    await expect(
      atomicWriteJson(f.target, nextValue, {
        platform: 'win32',
        rename: replace,
        sleep: f.sleep,
        unlink: cleanup
      })
    ).rejects.toBe(error);
    const temporaryPath = replace.mock.calls[0]?.[0];
    expect(temporaryPath).toBeDefined();
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(temporaryPath);
    expect(temporaryPath).not.toBe(f.target);
    expect(await readFile(f.target, 'utf8')).toBe(oldContents);
    expect(await readdir(f.directory)).toHaveLength(2);
  });

  it('serialization failure leaves the target intact without creating a temp', async () => {
    const f = await fixture();
    const error = new Error('offline serialization error');
    await expect(
      atomicWriteJson(f.target, {
        toJSON: () => {
          throw error;
        }
      })
    ).rejects.toBe(error);
    expect(await readFile(f.target, 'utf8')).toBe(oldContents);
    expect(await readdir(f.directory)).toEqual(['journal.json']);
  });
});
