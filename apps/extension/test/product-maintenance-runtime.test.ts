import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewaySettings } from '@one-vegetable/core';
import { createProductOperationContext } from '@one-vegetable/core/product-operation-context';
import { isAccountVerifiedIopMethod } from '@one-vegetable/core/alibaba-iop-business';
import {
  PRODUCT_MAINTENANCE_METHODS,
  createProductMaintenanceIntent,
  type KnownProductDraft
} from '@one-vegetable/core/product-maintenance-api';
import { parseProductMaintenanceRecord } from '@one-vegetable/core/product-maintenance-service';
import credentials from '../../../mock/data/node-gateway-credentials.json';
import domain from '../../../mock/data/product-maintenance-api.json';
import records from '../../../mock/data/product-maintenance-repository.json';
import references from '../../../mock/data/product-reference/examples.json';
import { resolveAuthorization } from '../lib/alibaba-authorizations';
import { handleProductMaintenance } from '../lib/product-maintenance-service';
import { ExtensionProductMaintenanceRepository } from '../lib/product-maintenance-repository';

const ownerId = 'extension:local-admin';
const getMethod = '/alibaba/icbu/product/get/v2';
function settings(protocol: 'top' | 'iop'): GatewaySettings {
  return {
    appKey: credentials.oauthBundle.application.appKey,
    appSecret: credentials.oauthBundle.application.appSecret,
    accessToken: credentials.oauthBundle.oauth.accessToken,
    protocol,
    endpoint:
      protocol === 'iop' ? 'https://openapi-api.alibaba.com/rest' : 'https://eco.taobao.com/router/rest',
    signMethod: protocol === 'iop' ? 'hmac-sha256' : 'hmac'
  };
}
function profiles(preferred: 'top' | 'iop'): GatewaySettings {
  return {
    ...settings(preferred),
    protocolCredentials: {
      [preferred === 'top' ? 'iop' : 'top']: settings(preferred === 'top' ? 'iop' : 'top')
    }
  };
}
function known() {
  return vi.fn<Parameters<typeof handleProductMaintenance>[3]>(() =>
    Promise.resolve(
      domain.drafts.deleteBatch.knownDrafts.map(
        (row) =>
          ({
            kind: 'draft' as const,
            draftId: row.draftId,
            source: row.source === 'draft-list' ? ('draft-list' as const) : ('draft-create' as const)
          }) satisfies KnownProductDraft
      )
    )
  );
}
function loader(current: GatewaySettings) {
  return vi.fn<Parameters<typeof handleProductMaintenance>[2]>((intent, expectedGateway) =>
    resolveAuthorization(
      current,
      'callCapability',
      { method: intent.method, parameters: intent.parameters },
      expectedGateway,
      'PRODUCT_CONTEXT_CHANGED'
    )
  );
}
let network: ReturnType<typeof vi.fn<typeof fetch>>;
let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory();
  vi.stubGlobal('indexedDB', factory);
  network = vi.fn<typeof fetch>((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== 'https://openapi-api.alibaba.com' || !url.pathname.endsWith(getMethod))
      return Promise.reject(new Error('UNEXPECTED_PROVIDER_WRITE'));
    return Promise.resolve(Response.json(structuredClone(references[getMethod].response)));
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Extension product maintenance trusted runtime', () => {
  it.each(['create', 'list', 'send', 'verify'])(
    'rejects untrusted %s before authorization, storage or networking',
    async (action) => {
      const load = loader(profiles('top'));
      const drafts = known();
      const open = vi.spyOn(factory, 'open');
      const result = await handleProductMaintenance(
        {
          requestId: crypto.randomUUID(),
          context: records.context,
          command: { action }
        },
        false,
        load,
        drafts
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'PRODUCT_MAINTENANCE_UNTRUSTED_SENDER',
          retryable: false
        }
      });
      expect(load).not.toHaveBeenCalled();
      expect(drafts).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    }
  );
  it('rejects malformed trusted requests before loading credentials', async () => {
    const load = loader(profiles('top'));
    const drafts = known();
    expect(
      await handleProductMaintenance(
        {
          requestId: 'invalid\nrequest',
          context: records.context,
          command: { action: 'list' }
        },
        true,
        load,
        drafts
      )
    ).toMatchObject({ ok: false, error: { code: 'REQUEST_CONTRACT_INVALID' } });
    expect(load).not.toHaveBeenCalled();
    expect(drafts).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
  it('lists local durable metadata without requiring Alibaba authorization', async () => {
    const load = loader(profiles('top'));
    const drafts = known();
    const requestId = crypto.randomUUID();
    expect(
      await handleProductMaintenance(
        {
          requestId,
          context: records.context,
          command: { action: 'list' }
        },
        true,
        load,
        drafts
      )
    ).toEqual({ requestId, ok: true, data: { tasks: [] } });
    expect(load).not.toHaveBeenCalled();
    expect(drafts).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
  for (const preferred of ['top', 'iop'] as const) {
    it.each([
      ['price', domain.drafts.tiered, PRODUCT_MAINTENANCE_METHODS.setPrice],
      ['inventory', domain.drafts.inventory, PRODUCT_MAINTENANCE_METHODS.setInventory],
      ['draft', domain.drafts.deleteOne, PRODUCT_MAINTENANCE_METHODS.deleteDraft]
    ] as const)(
      'selects the actual %s method and pinned IOP configuration with default ' + preferred,
      async (_kind, draft, method) => {
        const context = await createProductOperationContext(ownerId, settings('iop'));
        const load = loader(profiles(preferred));
        const drafts = known();
        const result = await handleProductMaintenance(
          {
            requestId: crypto.randomUUID(),
            context,
            command: { action: 'create', draft }
          },
          true,
          load,
          drafts
        );
        expect(result).toMatchObject({ ok: true });
        expect(load).toHaveBeenCalledOnce();
        expect(load.mock.calls[0]).toEqual([await createProductMaintenanceIntent(draft), context.gateway]);
        // Resolver receives the mutation's real payload, not an unrelated read/photo placeholder.
        const intent = load.mock.calls[0]?.[0];
        expect(intent?.method).toBe(method);
        expect(intent?.parameters).toEqual(
          records.records[
            draft.operation === 'setPrice'
              ? 'price'
              : draft.operation === 'setInventory'
                ? 'inventory'
                : 'deleteOne'
          ].task.intent.parameters
        );
        expect(drafts).toHaveBeenCalledExactlyOnceWith(context.gateway);
        const saved = (await new ExtensionProductMaintenanceRepository().list(ownerId))[0];
        expect(saved?.task.protocol).toBe('iop');
        expect(saved?.task.context).toEqual(context);
        expect(saved?.task.status).toBe('prepared');
        expect(saved?.task.submitAttempted).toBe(false);
        if ('draftIds' in draft) expect(network).not.toHaveBeenCalled();
        else {
          expect(network).toHaveBeenCalledOnce();
          const body = network.mock.calls[0]?.[1]?.body;
          expect(body).toBeInstanceOf(URLSearchParams);
          if (!(body instanceof URLSearchParams)) throw new Error('Missing signed IOP body');
          expect(body.get('product_id')).toBe(draft.productId);
          expect(body.has('method')).toBe(false);
          expect(body.has('session')).toBe(false);
        }
        expect(JSON.stringify(result)).not.toContain(credentials.oauthBundle.application.appSecret);
        expect(JSON.stringify(result)).not.toContain(credentials.oauthBundle.oauth.accessToken);
      }
    );
  }
  it.each(['inventory', 'price', 'deleteOne'] as const)(
    'refuses unaccepted %s send before dispatch or claim',
    async (name) => {
      const context = await createProductOperationContext(ownerId, settings('iop'));
      const record = parseProductMaintenanceRecord(records.records[name]);
      record.ownerId = ownerId;
      record.task.context = context;
      const repository = new ExtensionProductMaintenanceRepository();
      await repository.save(record, null);
      expect(isAccountVerifiedIopMethod(record.task.intent.method)).toBe(false);
      const load = loader(profiles('top'));
      const drafts = known();
      const requestId = crypto.randomUUID();
      expect(
        await handleProductMaintenance(
          {
            requestId,
            context,
            command: {
              action: 'send',
              taskId: record.task.id,
              revision: record.task.revision,
              fingerprint: record.task.intent.fingerprint
            }
          },
          true,
          load,
          drafts
        )
      ).toEqual({
        requestId,
        ok: false,
        error: {
          code: 'PRODUCT_MAINTENANCE_METHOD_DISABLED',
          message: 'PRODUCT_MAINTENANCE_METHOD_DISABLED',
          retryable: false
        }
      });
      expect(load).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          method: record.task.intent.method,
          parameters: record.task.intent.parameters
        }),
        context.gateway
      );
      expect(await repository.get(record.task.id, ownerId)).toEqual(record);
      expect(network).not.toHaveBeenCalled();
    }
  );
  it('blocks replaced configuration before provider reads or any durable send claim', async () => {
    const context = await createProductOperationContext(ownerId, settings('iop'));
    const record = parseProductMaintenanceRecord(records.records.inventory);
    record.ownerId = ownerId;
    record.task.context = context;
    const repository = new ExtensionProductMaintenanceRepository();
    await repository.save(record, null);
    const changed = { ...settings('iop'), appKey: records.secondTaskId };
    const load = loader({ ...settings('top'), protocolCredentials: { iop: changed } });
    const drafts = known();
    expect(
      await handleProductMaintenance(
        {
          requestId: crypto.randomUUID(),
          context,
          command: {
            action: 'send',
            taskId: record.task.id,
            revision: 1,
            fingerprint: record.task.intent.fingerprint
          }
        },
        true,
        load,
        drafts
      )
    ).toMatchObject({ ok: false, error: { code: 'PRODUCT_CONTEXT_CHANGED', retryable: false } });
    expect(load).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        method: PRODUCT_MAINTENANCE_METHODS.setInventory
      }),
      context.gateway
    );
    expect(drafts).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(await repository.get(record.task.id, ownerId)).toEqual(record);
  });
  it('independently rejects a loader returning the wrong IOP configuration', async () => {
    const context = await createProductOperationContext(ownerId, settings('iop'));
    const load = vi.fn<Parameters<typeof handleProductMaintenance>[2]>(() =>
      Promise.resolve({ ...settings('iop'), appKey: records.secondTaskId })
    );
    const drafts = known();
    expect(
      await handleProductMaintenance(
        {
          requestId: crypto.randomUUID(),
          context,
          command: { action: 'create', draft: domain.drafts.inventory }
        },
        true,
        load,
        drafts
      )
    ).toMatchObject({ ok: false, error: { code: 'PRODUCT_CONTEXT_CHANGED' } });
    expect(network).not.toHaveBeenCalled();
    expect(await new ExtensionProductMaintenanceRepository().list(ownerId)).toEqual([]);
  });
  it('rejects a TOP-only loader instead of borrowing the default authorization', async () => {
    const context = await createProductOperationContext(ownerId, settings('iop'));
    const load = vi.fn<Parameters<typeof handleProductMaintenance>[2]>(() =>
      Promise.resolve(settings('top'))
    );
    const drafts = known();
    expect(
      await handleProductMaintenance(
        {
          requestId: crypto.randomUUID(),
          context,
          command: { action: 'create', draft: domain.drafts.inventory }
        },
        true,
        load,
        drafts
      )
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED' } });
    expect(drafts).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
});
