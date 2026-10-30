type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: '#/components/schemas/' + name });
const str: Schema = { type: 'string', minLength: 1, maxLength: 128 };
const id: Schema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const int: Schema = { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' };
const money: Schema = { type: 'string', maxLength: 128, pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' };
const hash: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision: Schema = { type: 'integer', minimum: 1 };
const time: Schema = { type: 'integer', minimum: 0 };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});
const array = (items: Schema, maxItems = 500): Schema => ({ type: 'array', minItems: 1, maxItems, items });
export function productMaintenanceTransportSchemas(): Record<string, Schema> {
  const tier = obj({ quantity: int, price: money });
  const priceHeader = { operation: { const: 'setPrice' }, productId: id };
  const inventoryHeader = { operation: { const: 'setInventory' }, productId: id };
  const knownDraft = obj({
    kind: { const: 'draft' },
    draftId: id,
    source: { enum: ['draft-list', 'draft-create'] }
  });
  const draft = {
    oneOf: [
      obj({ ...priceHeader, mode: { const: 'tiered' }, currency: { const: 'USD' }, tiers: array(tier) }),
      obj({
        ...priceHeader,
        mode: { const: 'range' },
        currency: { const: 'USD' },
        minPrice: money,
        maxPrice: money
      }),
      obj({
        ...priceHeader,
        mode: { const: 'sku' },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        skus: array(obj({ skuId: id, price: money }))
      }),
      obj({ ...inventoryHeader, mode: { const: 'spu' }, inventory: int }),
      obj({ ...inventoryHeader, mode: { const: 'sku' }, skus: array(obj({ skuId: id, inventory: int })) }),
      obj({
        operation: { const: 'deleteDraft' },
        draftIds: array(id, 1),
        knownDrafts: array(knownDraft, 100)
      })
    ]
  };
  const command = {
    oneOf: [
      obj({ action: { const: 'create' }, draft: ref('ProductValueMaintenanceDraft') }),
      obj({ action: { const: 'get' }, taskId: str }),
      obj({ action: { const: 'list' } }),
      obj({ action: { const: 'send' }, taskId: str, revision, fingerprint: hash }),
      obj({ action: { enum: ['verify', 'cancel'] }, taskId: str, revision })
    ]
  };
  const schemas: Record<string, Schema> = {
    ProductValueMaintenanceDraft: draft,
    ProductValueMaintenanceCommand: command,
    ProductValueMaintenanceRequest: obj({
      requestId: { type: 'string', format: 'uuid' },
      context: ref('ProductOperationContext'),
      command: ref('ProductValueMaintenanceCommand')
    })
  };
  const operation: Schema = { enum: ['setPrice', 'setInventory', 'deleteDraft'] };
  const receipt = obj(
    {
      operation,
      protocol: { const: 'iop' },
      status: { enum: ['accepted', 'rejected', 'partial', 'ambiguous'] },
      reason: { enum: ['explicit-success', 'explicit-rejection', 'incomplete-evidence', 'unknown-outcome'] },
      readbackRequired: { const: true },
      items: {
        type: 'array',
        items: obj({ draftId: id, status: { enum: ['reported-deleted', 'rejected', 'ambiguous'] } })
      }
    },
    ['operation', 'protocol', 'status', 'reason', 'readbackRequired']
  );
  const fieldPaths: Schema = { type: 'array', items: { type: 'string', maxLength: 256 } };
  const readback = obj({
    status: { enum: ['matched', 'mismatched', 'unavailable'] },
    mismatchedFields: fieldPaths,
    unavailableFields: fieldPaths,
    checkedTimeUtc: time
  });
  schemas.ProductValueMaintenanceTask = obj({
    schemaVersion: { const: 1 },
    id: str,
    revision,
    requestId: { type: 'string', format: 'uuid' },
    context: ref('ProductOperationContext'),
    protocol: { const: 'iop' },
    intent: obj({
      version: { const: 1 },
      operation,
      protocol: { const: 'iop' },
      method: {
        enum: ['/icbu/product/edit-price', '/icbu/product/edit-inventory', '/alibaba/icbu/draft/delete']
      },
      parameters: { type: 'object', additionalProperties: true },
      draft: ref('ProductValueMaintenanceDraft'),
      fingerprint: hash
    }),
    baseline: nullable(
      obj({
        productId: id,
        fields: { type: 'object', additionalProperties: { type: 'string' } },
        fingerprint: hash
      })
    ),
    status: {
      enum: [
        'prepared',
        'dispatching',
        'accepted',
        'rejected',
        'partial',
        'ambiguous',
        'verified',
        'cancelled'
      ]
    },
    submitAttempted: { type: 'boolean' },
    createTimeUtc: time,
    updateTimeUtc: time,
    submittedTimeUtc: nullable(time),
    receipt: nullable(receipt),
    readback: nullable(readback),
    reasonCode: nullable({ type: 'string', pattern: '^[A-Z_]{1,128}$' })
  });
  schemas.ProductValueMaintenanceResult = obj({
    tasks: { type: 'array', maxItems: 100, items: ref('ProductValueMaintenanceTask') }
  });
  schemas.ProductValueMaintenanceResponse = obj({
    requestId: { type: 'string', format: 'uuid' },
    ok: { const: true },
    data: ref('ProductValueMaintenanceResult')
  });
  return schemas;
}
