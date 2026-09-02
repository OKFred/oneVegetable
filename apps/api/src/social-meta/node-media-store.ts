import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { SocialMediaStoredObject, SocialMediaStore } from './media-store';

export class NodeSocialMediaStore implements SocialMediaStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const path = this.#path(key);
    await mkdir(this.#root, { recursive: true });
    await Promise.all([
      writeFile(path, bytes, { flag: 'wx' }),
      writeFile(`${path}.type`, contentType, { encoding: 'utf8', flag: 'wx' })
    ]).catch(async (error: unknown) => {
      await Promise.allSettled([rm(path, { force: true }), rm(`${path}.type`, { force: true })]);
      throw error;
    });
  }

  async get(key: string): Promise<SocialMediaStoredObject | null> {
    const path = this.#path(key);
    try {
      const [bytes, contentType] = await Promise.all([readFile(path), readFile(`${path}.type`, 'utf8')]);
      return { bytes: new Uint8Array(bytes), contentType: contentType.trim() };
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.#path(key);
    await Promise.all([rm(path, { force: true }), rm(`${path}.type`, { force: true })]);
  }

  #path(key: string): string {
    if (!/^[0-9a-f-]{36}$/u.test(key)) throw new Error('社交素材存储键无效');
    const path = resolve(this.#root, key);
    if (!path.startsWith(`${this.#root}\\`) && !path.startsWith(`${this.#root}/`)) {
      throw new Error('社交素材存储路径越界');
    }
    return path;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
