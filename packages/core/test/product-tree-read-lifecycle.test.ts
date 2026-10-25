import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/authorization-mode-regression.json';
import { ProductAdapter } from '../src/product-adapter';
import type { AlibabaClient } from '../src/alibaba-client';

describe('tree reads drain their own context after rejection', () => {
  it.each(['categories', 'groups'] as const)('stops scheduling and waits for siblings: %s', async (kind) => {
    const pending: {
      resolve(value: Awaited<ReturnType<AlibabaClient['call']>>): void;
      reject(error: unknown): void;
    }[] = [];
    const response = (method: string, data: unknown) => ({ method, data });
    const call = vi.fn<AlibabaClient['call']>((method, parameters) => {
      const id = kind === 'categories' ? parameters.cat_id : parameters.group_id;
      if (id === 0 || id === -1)
        return Promise.resolve(
          response(method, kind === 'categories' ? fixture.categoryRoot : fixture.groupRoot)
        );
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    });
    const adapter = new ProductAdapter({ call });
    let settled = false;
    const outcome = (kind === 'categories' ? adapter.listCategories() : adapter.listGroups()).then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      }
    );
    await vi.waitFor(() => {
      expect(pending).toHaveLength(4);
    });
    const failure = new Error('Read failed');
    const first = pending[0];
    if (!first) throw new Error('Missing first request');
    first.reject(failure);
    await new Promise<void>((done) => setTimeout(done, 0));
    expect(settled).toBe(false);
    expect(call).toHaveBeenCalledTimes(5);
    const method = call.mock.calls[0]?.[0];
    if (!method) throw new Error('Missing root request');
    for (const item of pending.slice(1))
      item.resolve(response(method, kind === 'categories' ? fixture.categoryChild : fixture.groupChild));
    expect(await outcome).toBe(failure);
    expect(call).toHaveBeenCalledTimes(5);
  });
});
