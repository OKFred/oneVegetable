import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_MAINTENANCE_METHODS,
  ProductMaintenanceAdapter,
  createProductMaintenanceIntent,
  classifyProductMaintenanceResponse,
  classifyProductMaintenanceError,
  validateProductMaintenanceDiagnostics
} from '../src/product-maintenance-api';
import type { ProductMaintenanceResult, ProductMaintenanceCoordinator } from '../src/product-maintenance-api';
import { PRODUCT_MAINTENANCE_METHODS as LIGHTWEIGHT_METHODS } from '../src/product-workbench-methods';
import { parseProductMaintenanceRecord } from '../src/product-maintenance-service';
import type { ProductMaintenanceRecord } from '../src/product-maintenance-service';
import { validateProductMaintenanceServiceResult } from '../src/product-maintenance-control';
import domain from '../../../mock/data/product-maintenance-api.json';
import records from '../../../mock/data/product-maintenance-repository.json';
import diagnostics from '../../../mock/data/product-maintenance-diagnostics.json';

// Parent owns generation. Compile the updated public schema in memory, never write generated validators.
vi.mock('../src/generated/validators-product-maintenance', async () => {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const { productMaintenanceTransportSchemas } =
    await import('../../../scripts/lib/product-maintenance-transport');
  const api = JSON.parse(
    await readFile(new URL('../../../openapi/one-vegetable.json', import.meta.url), 'utf8')
  ) as { components: { schemas: Record<string, unknown> } };
  const schemas = {
    ...productMaintenanceTransportSchemas(),
    ProductOperationContext: api.components.schemas.ProductOperationContext
  };
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile({
    $ref: '#/components/schemas/ProductValueMaintenanceResult',
    components: { schemas }
  });
  return { validateProductValueMaintenanceResult: validate };
});

function recordWith(receipt: ProductMaintenanceResult): ProductMaintenanceRecord {
  const value = parseProductMaintenanceRecord(records.records.inventory);
  value.task.requestId = diagnostics.requestId;
  value.task.status = receipt.status;
  value.task.submitAttempted = true;
  value.task.submittedTimeUtc = value.task.createTimeUtc;
  value.task.receipt = receipt;
  return value;
}
function rejected(): ProductMaintenanceResult {
  return classifyProductMaintenanceResponse(domain.drafts.inventory, diagnostics.response);
}
const properties = ['errorCode', 'subCode', 'traceId'] as const;

describe('sanitized optional maintenance diagnostic fields', () => {
  it('re-exports the unchanged lightweight native-method object', () => {
    expect(PRODUCT_MAINTENANCE_METHODS).toBe(LIGHTWEIGHT_METHODS);
  });
  it('preserves stable native business codes and request trace without message/body/parameters', () => {
    const result = rejected();
    expect(result.status).toBe('rejected');
    expect(result).toMatchObject(diagnostics.diagnostics);
    expect(JSON.stringify(result)).not.toContain(diagnostics.privateMarker);
    expect(result).not.toHaveProperty('message');
    expect(result).not.toHaveProperty('parameters');
    expect(result).not.toHaveProperty('body');
  });
  it('keeps normalized gateway rejection diagnostics without changing the conservative outcome', () => {
    const result = classifyProductMaintenanceError('setInventory', diagnostics.exception);
    expect(result.status).toBe('ambiguous');
    expect(result.errorCode).toBe(diagnostics.exception.gatewayError.code);
    expect(result.subCode).toBe(diagnostics.diagnostics.subCode);
    expect(result.traceId).toBe(diagnostics.diagnostics.traceId);
    expect(JSON.stringify(result)).not.toContain(diagnostics.privateMarker);
    expect(classifyProductMaintenanceError('setInventory', diagnostics.permission).status).toBe('rejected');
  });
  it('retains explicit error-root and envelope atoms while keeping their outcome ambiguous', () => {
    const root = classifyProductMaintenanceResponse(domain.drafts.inventory, diagnostics.errorRoot);
    expect(root.status).toBe('ambiguous');
    expect(root.errorCode).toBe(String(diagnostics.stableNumericCode));
    expect(root.subCode).toBe(diagnostics.diagnostics.subCode);
    expect(root.traceId).toBe(diagnostics.diagnostics.traceId);
    const envelope = classifyProductMaintenanceResponse(domain.drafts.inventory, diagnostics.envelope);
    expect(envelope.status).toBe('ambiguous');
    expect(envelope.errorCode).toBe(diagnostics.envelope.code);
  });
  it('preserves trace-only acceptance without manufacturing an error or a completed state', () => {
    const result = classifyProductMaintenanceResponse(domain.drafts.inventory, diagnostics.accepted);
    expect(result.status).toBe('accepted');
    expect(result.traceId).toBe(diagnostics.diagnostics.traceId);
    expect(result).not.toHaveProperty('errorCode');
    expect(result).not.toHaveProperty('subCode');
    expect(result.readbackRequired).toBe(true);
  });
  it('retains root diagnostic atoms for rejected and partial draft receipts', () => {
    const single = classifyProductMaintenanceResponse(domain.drafts.deleteOne, diagnostics.draftRejected);
    expect(single.status).toBe('rejected');
    expect(single.errorCode).toBe(diagnostics.draftRejected.msg_code);
    expect(single.traceId).toBe(diagnostics.diagnostics.traceId);
    const partial = classifyProductMaintenanceResponse(domain.drafts.deleteBatch, diagnostics.rawPartial);
    expect(partial.status).toBe('partial');
    expect(partial.errorCode).toBe(diagnostics.rawPartial.msg_code);
    expect(JSON.stringify(partial)).not.toContain(diagnostics.privateMarker);
  });
  it.each(diagnostics.invalidCodeValues.map((value, index) => ({ value, index })))(
    'drops unsafe native/gateway code values #$index without trimming or truncation',
    ({ value }) => {
      const raw = {
        ...diagnostics.response,
        result: { ...diagnostics.response.result, msg_code: value, sub_code: value }
      };
      const native = classifyProductMaintenanceResponse(domain.drafts.inventory, raw);
      expect(native).not.toHaveProperty('errorCode');
      expect(native).not.toHaveProperty('subCode');
      const error = classifyProductMaintenanceError('setInventory', {
        gatewayError: { code: value, subCode: value }
      });
      expect(error).not.toHaveProperty('errorCode');
      expect(error).not.toHaveProperty('subCode');
    }
  );
  it.each(diagnostics.invalidTraceValues.map((value, index) => ({ value, index })))(
    'drops unsafe trace values #$index without fallback to message/body',
    ({ value }) => {
      const raw = { ...diagnostics.response, request_id: value };
      expect(classifyProductMaintenanceResponse(domain.drafts.inventory, raw)).not.toHaveProperty('traceId');
      expect(
        classifyProductMaintenanceError('setInventory', { gatewayError: { traceId: value } })
      ).not.toHaveProperty('traceId');
    }
  );
  it('never inspects message/body/cause for codes and accepts the exact ASCII length boundaries', () => {
    const result = classifyProductMaintenanceError('setInventory', diagnostics.messageOnly);
    expect(properties.some((key) => key in result)).toBe(false);
    expect(validateProductMaintenanceDiagnostics(diagnostics.bounds)).toBe(true);
    expect(validateProductMaintenanceDiagnostics({})).toBe(true);
    expect(
      validateProductMaintenanceDiagnostics({
        ...diagnostics.bounds,
        errorCode: diagnostics.stableNumericCode
      })
    ).toBe(false);
  });
  it('uses an already-sanitized call trace when the native body has no trace', async () => {
    const call = vi.fn((method: string) =>
      Promise.resolve({ method, data: domain.responses.accepted, traceId: diagnostics.fallbackTrace })
    );
    const coordinator: ProductMaintenanceCoordinator = {
      run: (intent, send) =>
        send({
          protocol: 'iop',
          persistedIntentId: records.taskId,
          fingerprint: intent.fingerprint
        })
    };
    const result = await new ProductMaintenanceAdapter({ call }, coordinator).execute(
      await createProductMaintenanceIntent(domain.drafts.inventory)
    );
    expect(result.traceId).toBe(diagnostics.fallbackTrace);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('stored/control receipts and the updated public schema', () => {
  it('roundtrips optional fields through the service structural parser and future generated control validator', async () => {
    const value = recordWith(rejected());
    const parsed = parseProductMaintenanceRecord(value);
    expect(parsed.task.receipt).toMatchObject(diagnostics.diagnostics);
    const checked = await validateProductMaintenanceServiceResult({ tasks: [value.task] });
    expect(checked.tasks[0]?.receipt).toMatchObject(diagnostics.diagnostics);
    expect(JSON.stringify(checked)).not.toContain(diagnostics.privateMarker);
  });
  it('keeps legacy receipts without diagnostics valid and tests exact boundary lengths', async () => {
    const legacy = recordWith(
      classifyProductMaintenanceResponse(domain.drafts.inventory, domain.responses.accepted)
    );
    expect(parseProductMaintenanceRecord(legacy).task.receipt).not.toHaveProperty('errorCode');
    await expect(validateProductMaintenanceServiceResult({ tasks: [legacy.task] })).resolves.toHaveProperty(
      'tasks'
    );
    const bounded = recordWith({ ...rejected(), ...diagnostics.bounds });
    await expect(validateProductMaintenanceServiceResult({ tasks: [bounded.task] })).resolves.toHaveProperty(
      'tasks'
    );
  });
  for (const property of properties) {
    const values = property === 'traceId' ? diagnostics.invalidTraceValues : diagnostics.invalidCodeValues;
    it.each(values.map((value, index) => ({ value, index })))(
      'rejects stored/control invalid ' + property + ' #$index',
      async ({ value }) => {
        const receipt = { ...rejected(), [property]: value };
        const input = recordWith(receipt);
        expect(validateProductMaintenanceDiagnostics(receipt)).toBe(false);
        expect(() => parseProductMaintenanceRecord(input)).toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
        await expect(validateProductMaintenanceServiceResult({ tasks: [input.task] })).rejects.toThrow(
          'PRODUCT_MAINTENANCE_RESPONSE_INVALID'
        );
      }
    );
  }
  it.each(diagnostics.invalidStoredValues.map((value, index) => ({ value, index })))(
    'does not coerce stored diagnostic values #$index',
    async ({ value }) => {
      const input = recordWith({ ...rejected(), errorCode: value } as ProductMaintenanceResult);
      expect(() => parseProductMaintenanceRecord(input)).toThrow();
      await expect(validateProductMaintenanceServiceResult({ tasks: [input.task] })).rejects.toThrow();
    }
  );
  it('rejects explicit undefined optional values and never admits raw message fields', async () => {
    const receipt = { ...rejected(), errorCode: undefined };
    const input = recordWith(receipt as unknown as ProductMaintenanceResult);
    expect(() => parseProductMaintenanceRecord(input)).toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    const raw = recordWith({ ...rejected(), message: diagnostics.privateMarker } as ProductMaintenanceResult);
    expect(() => parseProductMaintenanceRecord(raw)).toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    await expect(validateProductMaintenanceServiceResult({ tasks: [raw.task] })).rejects.toThrow();
  });
});
