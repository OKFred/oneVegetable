import { describe, expect, it } from 'vitest';
import {
  GatewayException,
  type Product,
  type ProductDisplayRequest,
  type ProductMutationJob,
  type ProductPage
} from '@one-vegetable/core';
import fixture from '../../../mock/data/iop-display-extension.json';
import {
  ExtensionProductDisplayMutationLifecycle,
  type ExtensionProductDisplayGateway,
  type ExtensionProductMutationStorage
} from '../lib/product-display-mutation-lifecycle';
import { EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY as key } from '../lib/product-display-mutation-storage';

const request = fixture.request as ProductDisplayRequest;
const options = { productContext: fixture.context };
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing display test fixture');
  return value;
}

class Storage implements ExtensionProductMutationStorage {
  values: Record<string, unknown> = {};
  fail = false;
  get(name: string) {
    return Promise.resolve({ [name]: structuredClone(this.values[name]) });
  }
  set(value: Record<string, unknown>) {
    if (this.fail) return Promise.reject(new Error('Fixture storage failure'));
    Object.assign(this.values, structuredClone(value));
    return Promise.resolve();
  }
  job(): ProductMutationJob {
    return required((this.values[key] as { jobs: ProductMutationJob[] }).jobs[0]);
  }
}

function setup(protocol: 'top' | 'iop' = 'iop') {
  const storage = new Storage();
  const reads: unknown[] = [];
  const writes: ProductDisplayRequest[] = [];
  const page = structuredClone(fixture.page) as ProductPage;
  const product = required(page.items[0]);
  if (protocol === 'top') product.encryptedId = required(fixture.topRequest.encryptedProductIds[0]);
  let beforeWrite: (() => void) | undefined;
  let error: GatewayException | undefined;
  const gateway: ExtensionProductDisplayGateway = {
    protocol,
    list: (query) => {
      reads.push(query);
      return Promise.resolve(structuredClone(page));
    },
    updateDisplay: (input) => {
      beforeWrite?.();
      writes.push(structuredClone(input));
      if (error) return Promise.reject(error);
      return Promise.resolve(
        structuredClone(input.display === 'online' ? fixture.restoreAccepted : fixture.accepted) as Awaited<
          ReturnType<ExtensionProductDisplayGateway['updateDisplay']>
        >
      );
    }
  };
  return {
    storage,
    gateway,
    reads,
    writes,
    lifecycle: new ExtensionProductDisplayMutationLifecycle(storage, () => 10_000),
    status: (status: Product['status']) => {
      product.status = status;
    },
    beforeWrite: (hook: () => void) => {
      beforeWrite = hook;
    },
    error: (value: GatewayException | undefined) => {
      error = value;
    }
  };
}

async function submit(test: ReturnType<typeof setup>) {
  const result = await test.lifecycle.submit(test.gateway, 'fixture-display-request', request, options);
  return required(result.jobs[0]);
}

describe('extension plain-ID display lifecycle', () => {
  it('persists the actual IOP binding and baseline before dispatch, then verifies after restart', async () => {
    const test = setup();
    test.beforeWrite(() => {
      expect(test.storage.job()).toMatchObject({
        protocol: 'iop',
        productContext: fixture.context,
        encryptedProductId: null,
        status: 'submitted',
        originalDisplay: 'online',
        targetDisplay: 'offline'
      });
    });
    const job = await submit(test);
    expect(test.writes).toEqual([request]);
    test.status('offline');
    const restarted = new ExtensionProductDisplayMutationLifecycle(test.storage, () => 10_001);
    expect(await restarted.refresh(test.gateway, job.id, job.revision)).toMatchObject({
      status: 'verified',
      protocol: 'iop',
      productContext: fixture.context
    });
    expect(test.reads).toHaveLength(2);
    for (const query of test.reads) expect(query).toMatchObject({ productId: '100001', page: 1 });
  });

  it('requires an IOP context and rejects a resolved protocol mismatch before any read or write', async () => {
    const test = setup();
    await expect(test.lifecycle.submit(test.gateway, 'missing-context', request)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_CONTEXT_INVALID' }
    });
    await expect(
      test.lifecycle.submit({ ...test.gateway, protocol: 'top' }, 'wrong-protocol', request, options)
    ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' } });
    expect(test.reads).toEqual([]);
    expect(test.writes).toEqual([]);
  });

  it('sends neither write when its preceding persistence fails', async () => {
    const test = setup();
    test.storage.fail = true;
    await expect(submit(test)).rejects.toThrow('Fixture storage failure');
    expect(test.writes).toEqual([]);
    test.storage.fail = false;
    const job = await submit(test);
    test.status('offline');
    test.storage.fail = true;
    await expect(test.lifecycle.recover(test.gateway, job.id, job.revision)).rejects.toThrow(
      'Fixture storage failure'
    );
    expect(test.writes).toHaveLength(1);
    expect(test.storage.job()).toMatchObject({ status: 'verifying' });
    expect(test.storage.job().recoveryRequestId).toBeUndefined();
  });

  it('does not restore when the exact target is already at its original display', async () => {
    const test = setup();
    const job = await submit(test);
    expect(await test.lifecycle.recover(test.gateway, job.id, job.revision)).toMatchObject({
      status: 'recovered',
      reasonCode: 'PRODUCT_DISPLAY_ORIGINAL_STATE_CONFIRMED'
    });
    expect(test.writes).toHaveLength(1);
  });

  it('persists one new recovery request before restoring only the exact observed target', async () => {
    const test = setup();
    const job = await submit(test);
    test.status('offline');
    test.beforeWrite(() => {
      expect(test.storage.job()).toMatchObject({
        status: 'recovering',
        protocol: 'iop',
        productContext: fixture.context
      });
      expect(test.storage.job().recoveryRequestId).toEqual(expect.any(String));
      expect(test.storage.job().recoveryRequestId).not.toBe(job.requestId);
    });
    const recovering = await test.lifecycle.recover(test.gateway, job.id, job.revision);
    expect(test.writes[1]).toEqual({ ...request, display: 'online' });
    test.status('online');
    const restarted = new ExtensionProductDisplayMutationLifecycle(test.storage, () => 10_001);
    expect(await restarted.refresh(test.gateway, job.id, recovering.revision)).toMatchObject({
      status: 'recovered',
      recoveryRequestId: recovering.recoveryRequestId
    });
    expect(test.writes).toHaveLength(2);
  });

  it.each(['auditing', 'verified'] as const)('does not expand recovery eligibility to %s', async (status) => {
    const test = setup();
    const job = await submit(test);
    test.storage.job().status = status;
    await expect(test.lifecycle.recover(test.gateway, job.id, job.revision)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_MUTATION_RECOVERY_UNAVAILABLE' }
    });
    expect(test.reads).toHaveLength(1);
    expect(test.writes).toHaveLength(1);
  });

  it.each(['auditing', 'draft', 'rejected'] as const)(
    'does not restore an unexpected platform state: %s',
    async (status) => {
      const test = setup();
      const job = await submit(test);
      test.status(status);
      await expect(test.lifecycle.recover(test.gateway, job.id, job.revision)).rejects.toBeInstanceOf(
        GatewayException
      );
      expect(test.writes).toHaveLength(1);
      expect(test.storage.job().recoveryRequestId).toBeUndefined();
    }
  );

  it('never repeats an unknown restore after timeout and restart, and reads only the original state', async () => {
    const test = setup();
    const job = await submit(test);
    test.status('offline');
    test.error(new GatewayException(fixture.errors.unknown));
    await expect(test.lifecycle.recover(test.gateway, job.id, job.revision)).rejects.toBeInstanceOf(
      GatewayException
    );
    const pending = test.storage.job();
    expect(pending).toMatchObject({ status: 'recovery-required' });
    expect(pending.recoveryRequestId).toEqual(expect.any(String));
    const restarted = new ExtensionProductDisplayMutationLifecycle(test.storage, () => 200_000);
    await expect(restarted.recover(test.gateway, job.id, pending.revision)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_MUTATION_RECOVERY_UNAVAILABLE' }
    });
    const readback = await restarted.refresh(test.gateway, job.id, pending.revision);
    expect(readback.status).toBe('recovery-required');
    test.status('online');
    expect(await restarted.refresh(test.gateway, job.id, readback.revision)).toMatchObject({
      status: 'recovered',
      recoveryRequestId: pending.recoveryRequestId
    });
    expect(test.writes).toHaveLength(2);
  });

  it('retains the recovery marker if acceptance persistence fails or the worker crashes', async () => {
    const test = setup();
    const job = await submit(test);
    test.status('offline');
    test.beforeWrite(() => {
      test.storage.fail = true;
    });
    await expect(test.lifecycle.recover(test.gateway, job.id, job.revision)).rejects.toThrow(
      'Fixture storage failure'
    );
    const saved = structuredClone(test.storage.job());
    expect(saved).toMatchObject({ status: 'recovering' });
    expect(saved.recoveryRequestId).toEqual(expect.any(String));
    test.storage.fail = false;
    const restarted = new ExtensionProductDisplayMutationLifecycle(test.storage, () => 200_000);
    const pending = await restarted.refresh(test.gateway, job.id, saved.revision);
    await expect(restarted.recover(test.gateway, job.id, pending.revision)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_MUTATION_RECOVERY_UNAVAILABLE' }
    });
    expect(test.writes).toHaveLength(2);
  });

  it.each(['unknown', 'rejected'] as const)(
    'preserves the explicit %s classification for both writes',
    async (kind) => {
      const test = setup();
      test.error(new GatewayException(fixture.errors[kind]));
      await expect(submit(test)).rejects.toBeInstanceOf(GatewayException);
      expect(test.storage.job().status).toBe(kind === 'unknown' ? 'recovery-required' : 'failed');
      const restore = setup();
      const job = await submit(restore);
      restore.status('offline');
      restore.error(new GatewayException(fixture.errors[kind]));
      await expect(restore.lifecycle.recover(restore.gateway, job.id, job.revision)).rejects.toBeInstanceOf(
        GatewayException
      );
      expect(restore.storage.job()).toMatchObject({
        status: kind === 'unknown' ? 'recovery-required' : 'failed'
      });
      expect(restore.storage.job().recoveryRequestId).toEqual(expect.any(String));
    }
  );

  it('keeps historical missing-protocol TOP receipts readable and rejects an IOP gateway', async () => {
    const test = setup('top');
    const result = await test.lifecycle.submit(
      test.gateway,
      'legacy-request',
      fixture.topRequest as ProductDisplayRequest
    );
    const job = required(result.jobs[0]);
    delete test.storage.job().protocol;
    const restarted = new ExtensionProductDisplayMutationLifecycle(test.storage, () => 10_001);
    await expect(
      restarted.refresh({ ...test.gateway, protocol: 'iop' }, job.id, job.revision)
    ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' } });
    test.status('offline');
    expect(await restarted.refresh(test.gateway, job.id, job.revision)).toMatchObject({
      status: 'verified',
      encryptedProductId: 'fixture-top-cipher'
    });
    expect(test.writes).toHaveLength(1);
  });

  it('retains the unknown recovery marker through auditing and never re-enables recovery', async () => {
    const test = setup();
    const job = await submit(test);
    test.status('offline');
    test.error(new GatewayException(fixture.errors.unknown));
    await expect(test.lifecycle.recover(test.gateway, job.id, job.revision)).rejects.toBeInstanceOf(
      GatewayException
    );
    const pending = structuredClone(test.storage.job());
    test.error(undefined);
    test.status('auditing');
    const restarted = new ExtensionProductDisplayMutationLifecycle(test.storage, () => 200_000);
    const auditing = await restarted.refresh(test.gateway, job.id, pending.revision);
    expect(auditing).toMatchObject({ status: 'recovering', recoveryRequestId: pending.recoveryRequestId });
    await expect(restarted.recover(test.gateway, job.id, auditing.revision)).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_MUTATION_RECOVERY_UNAVAILABLE' }
    });
    test.status('online');
    expect(await restarted.refresh(test.gateway, job.id, auditing.revision)).toMatchObject({
      status: 'recovered',
      recoveryRequestId: pending.recoveryRequestId
    });
    expect(test.writes).toHaveLength(2);
  });
});
