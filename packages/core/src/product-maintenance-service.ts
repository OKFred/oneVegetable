import type { AlibabaClient } from './alibaba-client';
import {
  ProductMaintenanceAdapter,
  createProductMaintenanceIntent,
  comparePriceReadback,
  compareInventoryReadback,
  validateProductMaintenanceDiagnostics
} from './product-maintenance-api';
import type {
  KnownProductDraft,
  ProductMaintenanceCoordinator,
  ProductMaintenanceIntent,
  ProductMaintenanceReadback,
  ProductMaintenanceRequest,
  ProductMaintenanceResult,
  ProductMaintenanceSnapshot
} from './product-maintenance-api';
import {
  assertProductOperationContext,
  isProductOperationContext,
  requireProductOperationContext
} from './product-operation-context';
import type { ProductOperationContext } from './product-operation-context';

export type ProductMaintenanceTaskStatus =
  'prepared' | 'dispatching' | 'accepted' | 'rejected' | 'partial' | 'ambiguous' | 'verified' | 'cancelled';
export interface ProductMaintenanceTask {
  schemaVersion: 1;
  id: string;
  revision: number;
  requestId: string;
  context: ProductOperationContext;
  protocol: 'iop';
  intent: ProductMaintenanceIntent;
  baseline: ProductMaintenanceBaseline | null;
  status: ProductMaintenanceTaskStatus;
  submitAttempted: boolean;
  createTimeUtc: number;
  updateTimeUtc: number;
  submittedTimeUtc: number | null;
  receipt: ProductMaintenanceResult | null;
  readback: (ProductMaintenanceReadback & { checkedTimeUtc: number }) | null;
  reasonCode: string | null;
}
export interface ProductMaintenanceRecord {
  ownerId: string;
  task: ProductMaintenanceTask;
}
export interface ProductMaintenanceRepository {
  get(id: string, ownerId: string): Promise<ProductMaintenanceRecord | null>;
  list(ownerId: string): Promise<ProductMaintenanceRecord[]>;
  /** Atomic insert/CAS plus owner+context+entity locks. Nonterminal records retain all locks.
   * Throw on conflict/storage failure; never silently upsert or fall back to memory. */
  save(record: ProductMaintenanceRecord, expectedRevision: number | null): Promise<void>;
}
export type ProductMaintenanceCommand =
  | { action: 'create'; draft: unknown }
  | { action: 'get'; taskId: string }
  | { action: 'list' }
  | { action: 'send'; taskId: string; revision: number; fingerprint: string }
  | { action: 'verify' | 'cancel'; taskId: string; revision: number };
export interface ProductMaintenanceServiceRequest {
  requestId: string;
  context: ProductOperationContext;
  command: ProductMaintenanceCommand;
}
export interface ProductMaintenanceServiceResult {
  tasks: ProductMaintenanceTask[];
}
export interface ProductMaintenanceRuntime {
  context: ProductOperationContext;
  protocol: 'top' | 'iop';
  /** Actual per-method flag and policy result, not a generic mutation permission. */
  enabled: boolean;
  client: Pick<AlibabaClient, 'call'>;
  readProduct?: (productId: string) => Promise<ProductMaintenanceSnapshot>;
  /** Trusted account-scoped list/create records, never copied from the submitted request. */
  knownDrafts?: readonly KnownProductDraft[];
  /** Only bounded, explicit absence/presence evidence. A failed query is NOT absence. */
  readDrafts?: (draftIds: readonly string[]) => Promise<
    readonly {
      draftId: string;
      status: 'absent' | 'present' | 'unknown';
    }[]
  >;
}
export type ProductMaintenanceResolver = (
  context: ProductOperationContext,
  requestId: string,
  intent: ProductMaintenanceRequest,
  phase: 'prepare' | 'send' | 'verify'
) => Promise<ProductMaintenanceRuntime>;

function fail(code: string): never {
  throw new Error(code);
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function token(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value);
}
function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    (value as unknown[]).every((item) => typeof item === 'string' && /^[A-Za-z0-9/_:-]{1,256}$/u.test(item))
  );
}
export function productMaintenanceIsTerminal(status: ProductMaintenanceTaskStatus): boolean {
  return ['verified', 'rejected', 'cancelled'].includes(status);
}
export function productMaintenanceLockEntities(task: ProductMaintenanceTask): string[] {
  const draft = task.intent.draft;
  return draft.operation === 'deleteDraft'
    ? draft.draftIds.map((id) => 'draft:' + id).sort()
    : ['product:' + draft.productId];
}
function receiptValid(value: unknown, operation: unknown): boolean {
  const item = record(value);
  if (
    !item ||
    !keys(item, [
      'operation',
      'protocol',
      'status',
      'reason',
      'readbackRequired',
      'items',
      'errorCode',
      'subCode',
      'traceId'
    ]) ||
    !validateProductMaintenanceDiagnostics(item) ||
    item.operation !== operation ||
    item.protocol !== 'iop' ||
    item.readbackRequired !== true ||
    !['accepted', 'rejected', 'partial', 'ambiguous'].includes(String(item.status)) ||
    !['explicit-success', 'explicit-rejection', 'incomplete-evidence', 'unknown-outcome'].includes(
      String(item.reason)
    )
  )
    return false;
  if (item.items === undefined) return true;
  return (
    Array.isArray(item.items) &&
    (item.items as unknown[]).every((raw) => {
      const row = record(raw);
      return (
        row &&
        keys(row, ['draftId', 'status']) &&
        typeof row.draftId === 'string' &&
        /^[1-9][0-9]*$/u.test(row.draftId) &&
        ['reported-deleted', 'rejected', 'ambiguous'].includes(String(row.status))
      );
    })
  );
}
function readbackValid(value: unknown): boolean {
  const item = record(value);
  return (
    item !== null &&
    keys(item, ['status', 'mismatchedFields', 'unavailableFields', 'checkedTimeUtc']) &&
    ['matched', 'mismatched', 'unavailable'].includes(String(item.status)) &&
    strings(item.mismatchedFields) &&
    strings(item.unavailableFields) &&
    timestamp(item.checkedTimeUtc)
  );
}
/** Structural loader only. Service additionally recomputes intent integrity before any use. */
export function parseProductMaintenanceRecord(value: unknown): ProductMaintenanceRecord {
  const raw = record(value);
  const task = record(raw?.task);
  const intent = record(task?.intent);
  const statuses = [
    'prepared',
    'dispatching',
    'accepted',
    'rejected',
    'partial',
    'ambiguous',
    'verified',
    'cancelled'
  ];
  if (
    !raw ||
    !keys(raw, ['ownerId', 'task']) ||
    !token(raw.ownerId) ||
    !task ||
    !keys(task, [
      'schemaVersion',
      'id',
      'revision',
      'requestId',
      'context',
      'protocol',
      'intent',
      'baseline',
      'status',
      'submitAttempted',
      'createTimeUtc',
      'updateTimeUtc',
      'submittedTimeUtc',
      'receipt',
      'readback',
      'reasonCode'
    ]) ||
    task.schemaVersion !== 1 ||
    !token(task.id) ||
    !revision(task.revision) ||
    !token(task.requestId) ||
    !isProductOperationContext(task.context) ||
    task.protocol !== 'iop' ||
    intent?.protocol !== 'iop' ||
    typeof intent.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(intent.fingerprint) ||
    !statuses.includes(String(task.status)) ||
    typeof task.submitAttempted !== 'boolean' ||
    !timestamp(task.createTimeUtc) ||
    !timestamp(task.updateTimeUtc) ||
    task.updateTimeUtc < task.createTimeUtc ||
    !(task.submittedTimeUtc === null || timestamp(task.submittedTimeUtc)) ||
    !(task.receipt === null || receiptValid(task.receipt, intent.operation)) ||
    !(intent.operation === 'deleteDraft' ? task.baseline === null : baselineValid(task.baseline)) ||
    !(task.readback === null || readbackValid(task.readback)) ||
    !(
      task.reasonCode === null ||
      (typeof task.reasonCode === 'string' && /^[A-Z_]{1,128}$/u.test(task.reasonCode))
    )
  )
    return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  const unattempted = task.status === 'prepared' || task.status === 'cancelled';
  if (
    unattempted !== !task.submitAttempted ||
    unattempted !== (task.submittedTimeUtc === null) ||
    (unattempted && (task.receipt !== null || task.readback !== null)) ||
    (task.status === 'dispatching' && task.receipt !== null) ||
    (task.status === 'verified' && record(task.readback)?.status !== 'matched') ||
    (['accepted', 'partial', 'rejected'].includes(String(task.status)) &&
      record(task.receipt)?.status !== task.status)
  )
    return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  return structuredClone(value) as ProductMaintenanceRecord;
}
function parseRequest(value: unknown): ProductMaintenanceServiceRequest {
  const raw = record(value);
  const command = record(raw?.command);
  if (
    !raw ||
    !keys(raw, ['requestId', 'context', 'command']) ||
    !token(raw.requestId) ||
    !isProductOperationContext(raw.context) ||
    !command
  )
    return fail('REQUEST_CONTRACT_INVALID');
  const action = command.action;
  if (
    (action === 'create' && keys(command, ['action', 'draft']) && command.draft !== undefined) ||
    (action === 'list' && keys(command, ['action']))
  )
    return structuredClone(value) as ProductMaintenanceServiceRequest;
  if (!token(command.taskId)) return fail('REQUEST_CONTRACT_INVALID');
  if (action === 'get' && keys(command, ['action', 'taskId']))
    return structuredClone(value) as ProductMaintenanceServiceRequest;
  if (!revision(command.revision)) return fail('REQUEST_CONTRACT_INVALID');
  if ((action === 'verify' || action === 'cancel') && keys(command, ['action', 'taskId', 'revision']))
    return structuredClone(value) as ProductMaintenanceServiceRequest;
  if (
    action === 'send' &&
    keys(command, ['action', 'taskId', 'revision', 'fingerprint']) &&
    typeof command.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/u.test(command.fingerprint)
  )
    return structuredClone(value) as ProductMaintenanceServiceRequest;
  return fail('REQUEST_CONTRACT_INVALID');
}

/** Request-sized, repository-backed commands. No scheduler, generic call route or retry loop. */
export class ProductMaintenanceService {
  constructor(
    private readonly repository: ProductMaintenanceRepository,
    private readonly resolve: ProductMaintenanceResolver,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => crypto.randomUUID()
  ) {}
  async execute(ownerId: string, value: unknown): Promise<ProductMaintenanceServiceResult> {
    if (!token(ownerId)) return fail('PRODUCT_MAINTENANCE_OWNER_INVALID');
    const request = parseRequest(value);
    const command = request.command;
    if (command.action === 'list') {
      const tasks: ProductMaintenanceTask[] = [];
      for (const raw of await this.repository.list(ownerId)) {
        const item = await this.load(raw, ownerId);
        if (
          item.task.context.identity === request.context.identity &&
          item.task.context.gateway === request.context.gateway
        )
          tasks.push(item.task);
      }
      return { tasks };
    }
    if (command.action === 'create') {
      let intent = await createProductMaintenanceIntent(command.draft);
      const runtime = await this.runtime(request, intent, 'prepare', request.context);
      if (intent.draft.operation === 'deleteDraft') {
        if (!runtime.knownDrafts) return fail('PRODUCT_MAINTENANCE_KNOWN_DRAFT_REQUIRED');
        intent = await createProductMaintenanceIntent({ ...intent.draft, knownDrafts: runtime.knownDrafts });
      }
      const now = this.time();
      const id = this.newId();
      if (!token(id)) return fail('PRODUCT_MAINTENANCE_TASK_ID_INVALID');
      const task: ProductMaintenanceTask = {
        schemaVersion: 1,
        id,
        revision: 1,
        requestId: request.requestId,
        context: structuredClone(runtime.context),
        protocol: 'iop',
        intent,
        baseline: intent.draft.operation === 'deleteDraft' ? null : await this.baseline(intent, runtime),
        status: 'prepared',
        submitAttempted: false,
        createTimeUtc: now,
        updateTimeUtc: now,
        submittedTimeUtc: null,
        receipt: null,
        readback: null,
        reasonCode: null
      };
      await this.repository.save({ ownerId, task }, null);
      return { tasks: [structuredClone(task)] };
    }
    const stored = await this.repository.get(command.taskId, ownerId);
    if (!stored) return fail('PRODUCT_MAINTENANCE_TASK_NOT_FOUND');
    const item = await this.load(stored, ownerId);
    if (item.task.id !== command.taskId) return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    assertProductOperationContext(item.task.context, request.context);
    if (command.action === 'get') return { tasks: [item.task] };
    if (command.revision !== item.task.revision) return fail('ENTITY_VERSION_CONFLICT');
    if (command.action === 'cancel') {
      if (item.task.submitAttempted || item.task.status !== 'prepared')
        return fail('PRODUCT_MAINTENANCE_ALREADY_ATTEMPTED');
      return this.saveNext(item, { status: 'cancelled' });
    }
    if (command.action === 'send') return this.send(item, request, command.fingerprint);
    return this.verify(item, request);
  }
  private async load(raw: unknown, ownerId: string): Promise<ProductMaintenanceRecord> {
    const item = parseProductMaintenanceRecord(raw);
    if (item.ownerId !== ownerId) return fail('PRODUCT_MAINTENANCE_TASK_NOT_FOUND');
    const expected = await createProductMaintenanceIntent(item.task.intent.draft);
    if (JSON.stringify(expected) !== JSON.stringify(item.task.intent))
      return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    if (
      item.task.baseline &&
      item.task.baseline.fingerprint !==
        (await baselineFingerprint(item.task.baseline.productId, item.task.baseline.fields))
    )
      return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    return item;
  }
  private async baseline(
    intent: ProductMaintenanceIntent,
    runtime: ProductMaintenanceRuntime
  ): Promise<ProductMaintenanceBaseline> {
    if (intent.draft.operation === 'deleteDraft' || !runtime.readProduct)
      return fail('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
    return createProductMaintenanceBaseline(intent.draft, await runtime.readProduct(intent.draft.productId));
  }
  private time(): number {
    const now = this.now();
    if (!timestamp(now)) return fail('PRODUCT_MAINTENANCE_CLOCK_INVALID');
    return now;
  }
  private async runtime(
    request: ProductMaintenanceServiceRequest,
    intent: ProductMaintenanceIntent,
    phase: 'prepare' | 'send' | 'verify',
    context: ProductOperationContext
  ): Promise<ProductMaintenanceRuntime> {
    const runtime = await this.resolve(context, request.requestId, intent, phase);
    requireProductOperationContext(runtime.context);
    assertProductOperationContext(context, runtime.context);
    if (runtime.protocol !== 'iop') return fail('PRODUCT_MAINTENANCE_IOP_REQUIRED');
    return runtime;
  }
  private async saveNext(
    item: ProductMaintenanceRecord,
    patch: Partial<ProductMaintenanceTask>
  ): Promise<ProductMaintenanceServiceResult> {
    const task = {
      ...item.task,
      ...patch,
      revision: item.task.revision + 1,
      updateTimeUtc: Math.max(this.time(), item.task.updateTimeUtc)
    };
    if (!revision(task.revision)) return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    const next = { ownerId: item.ownerId, task };
    parseProductMaintenanceRecord(next);
    await this.repository.save(structuredClone(next), item.task.revision);
    return { tasks: [structuredClone(task)] };
  }
  private async send(
    item: ProductMaintenanceRecord,
    request: ProductMaintenanceServiceRequest,
    fingerprint: string
  ): Promise<ProductMaintenanceServiceResult> {
    const task = item.task;
    if (task.submitAttempted || task.status !== 'prepared')
      return fail('PRODUCT_MAINTENANCE_ALREADY_ATTEMPTED');
    if (fingerprint !== task.intent.fingerprint) return fail('PRODUCT_MAINTENANCE_INTENT_MISMATCH');
    const runtime = await this.runtime(request, task.intent, 'send', task.context);
    if (!runtime.enabled) return fail('PRODUCT_MAINTENANCE_METHOD_DISABLED');
    if (task.intent.draft.operation === 'deleteDraft') {
      if (!runtime.readDrafts) return fail('PRODUCT_MAINTENANCE_DRAFT_VERIFICATION_UNAVAILABLE');
      if (!runtime.knownDrafts) return fail('PRODUCT_MAINTENANCE_KNOWN_DRAFT_REQUIRED');
      await createProductMaintenanceIntent({ ...task.intent.draft, knownDrafts: runtime.knownDrafts });
    }
    let reference: ProductMaintenanceSnapshot | undefined;
    if (task.intent.draft.operation !== 'deleteDraft') {
      if (!runtime.readProduct || !task.baseline) return fail('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
      reference = await runtime.readProduct(task.intent.draft.productId);
      const current = await createProductMaintenanceBaseline(task.intent.draft, reference);
      if (current.fingerprint !== task.baseline.fingerprint)
        return fail('PRODUCT_MAINTENANCE_BASELINE_CHANGED');
    }
    let finished: ProductMaintenanceServiceResult | undefined;
    const coordinator: ProductMaintenanceCoordinator = {
      run: async (intent, sendOnce) => {
        if (intent.fingerprint !== task.intent.fingerprint)
          return fail('PRODUCT_MAINTENANCE_INTENT_MISMATCH');
        // This CAS is the durable one-shot claim. Never clear submitAttempted or reclaim after a timeout.
        const claimedResult = await this.saveNext(item, {
          status: 'dispatching',
          submitAttempted: true,
          submittedTimeUtc: this.time()
        });
        const claimed = claimedResult.tasks[0] ?? fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
        const receipt = await sendOnce({
          protocol: 'iop',
          persistedIntentId: claimed.id,
          fingerprint: intent.fingerprint,
          ...(reference ? { reference } : {})
        });
        try {
          finished = await this.saveNext(
            { ownerId: item.ownerId, task: claimed },
            { status: receipt.status, receipt }
          );
        } catch {
          // The durable dispatching record is sufficient to prohibit resending after lost finalization.
          return fail('PRODUCT_MAINTENANCE_RESULT_NOT_PERSISTED');
        }
        return receipt;
      }
    };
    await new ProductMaintenanceAdapter(runtime.client, coordinator).execute(task.intent);
    return finished ?? fail('PRODUCT_MAINTENANCE_RESULT_NOT_PERSISTED');
  }
  private async verify(
    item: ProductMaintenanceRecord,
    request: ProductMaintenanceServiceRequest
  ): Promise<ProductMaintenanceServiceResult> {
    if (!item.task.submitAttempted || ['cancelled', 'rejected', 'verified'].includes(item.task.status))
      return fail('PRODUCT_MAINTENANCE_VERIFY_NOT_ALLOWED');
    const runtime = await this.runtime(request, item.task.intent, 'verify', item.task.context);
    const draft = item.task.intent.draft;
    let readback: ProductMaintenanceReadback = {
      status: 'unavailable',
      mismatchedFields: [],
      unavailableFields: ['readback']
    };
    try {
      if (draft.operation !== 'deleteDraft' && runtime.readProduct) {
        const snapshot = await runtime.readProduct(draft.productId);
        readback =
          draft.operation === 'setPrice'
            ? comparePriceReadback(draft, snapshot)
            : compareInventoryReadback(draft, snapshot);
      } else if (draft.operation === 'deleteDraft' && runtime.readDrafts) {
        const rows = await runtime.readDrafts(draft.draftIds);
        const mismatchedFields: string[] = [];
        const unavailableFields: string[] = [];
        if (rows.some((row) => !draft.draftIds.includes(row.draftId))) unavailableFields.push('drafts');
        for (const id of draft.draftIds) {
          const found = rows.filter((row) => row.draftId === id);
          if (found.length !== 1 || found[0]?.status === 'unknown') unavailableFields.push('drafts/' + id);
          else if (found[0]?.status === 'present') mismatchedFields.push('drafts/' + id);
          else if (found[0]?.status !== 'absent') unavailableFields.push('drafts/' + id);
        }
        readback = {
          status: mismatchedFields.length
            ? 'mismatched'
            : unavailableFields.length
              ? 'unavailable'
              : 'matched',
          mismatchedFields,
          unavailableFields
        };
      }
    } catch {
      /* No provider text or raw response is persisted. Unknown readback is not deletion evidence. */
    }
    return this.saveNext(item, {
      status:
        readback.status === 'matched'
          ? 'verified'
          : item.task.status === 'dispatching'
            ? 'ambiguous'
            : item.task.status,
      readback: { ...readback, checkedTimeUtc: this.time() },
      reasonCode:
        readback.status === 'matched'
          ? null
          : readback.status === 'mismatched'
            ? 'PRODUCT_MAINTENANCE_READBACK_MISMATCH'
            : 'PRODUCT_MAINTENANCE_READBACK_UNAVAILABLE'
    });
  }
}
/** Pure canonical hash over a read-only field map; no platform response or mutation. */
export { baselineFingerprint as createProductMaintenanceBaselineFingerprint };

export interface ProductMaintenanceBaseline {
  productId: string;
  /** Canonical scalars for ONLY the target field set. Never a ProductReference or platform response. */
  fields: Readonly<Record<string, string>>;
  fingerprint: string;
}
function baselineValid(value: unknown): value is ProductMaintenanceBaseline {
  const row = record(value);
  const fields = record(row?.fields);
  return (
    row !== null &&
    keys(row, ['productId', 'fields', 'fingerprint']) &&
    typeof row.productId === 'string' &&
    /^[1-9][0-9]{0,18}$/u.test(row.productId) &&
    typeof row.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/u.test(row.fingerprint) &&
    fields !== null &&
    Object.keys(fields).length > 0 &&
    Object.entries(fields).every(
      ([key, item]) =>
        /^(price\/(type|currency|min|max|tiers\/[1-9][0-9]*)|inventory|skus\/[1-9][0-9]*\/(price|currency|inventory))$/u.test(
          key
        ) &&
        typeof item === 'string' &&
        item.length <= 128 &&
        (key.endsWith('type')
          ? item === 'TIERED' || item === 'RANGE'
          : key.endsWith('currency')
            ? /^[A-Z]{3}$/u.test(item)
            : /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(item))
    )
  );
}
async function baselineFingerprint(
  productId: string,
  fields: Readonly<Record<string, string>>
): Promise<string> {
  const canonical = JSON.stringify({
    productId,
    fields: Object.fromEntries(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  });
  const bytes = new TextEncoder().encode(canonical);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function createProductMaintenanceBaseline(
  value: unknown,
  snapshot: ProductMaintenanceSnapshot
): Promise<ProductMaintenanceBaseline> {
  const draft = (await createProductMaintenanceIntent(value)).draft;
  if (draft.operation === 'deleteDraft' || snapshot.productId !== draft.productId)
    return fail('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
  const fields: Record<string, string> = {};
  const number = (path: string, input: unknown, integer = false): void => {
    if (
      typeof input !== 'string' ||
      input.length > 128 ||
      !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(input) ||
      (integer && (!/^(0|[1-9][0-9]*)$/u.test(input) || BigInt(input) > 9223372036854775807n))
    )
      return fail('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
    fields[path] = input.includes('.') ? input.replace(/0+$/u, '').replace(/\.$/u, '') : input;
  };
  if (draft.mode === 'sku') {
    for (const row of draft.skus) {
      const matches = snapshot.skus.filter((item) => item.id === row.skuId);
      const actual = matches[0];
      if (matches.length !== 1 || !actual) return fail('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
      if (draft.operation === 'setPrice') {
        if (actual.currency !== draft.currency) return fail('PRODUCT_MAINTENANCE_SKU_CURRENCY_UNCONFIRMED');
        fields['skus/' + row.skuId + '/currency'] = draft.currency;
        number('skus/' + row.skuId + '/price', actual.price);
      } else number('skus/' + row.skuId + '/inventory', actual.inventory, true);
    }
  } else if (draft.operation === 'setInventory') number('inventory', snapshot.inventory, true);
  else {
    const price = snapshot.price;
    if (price.currency !== draft.currency || (price.type !== 'TIERED' && price.type !== 'RANGE'))
      return fail('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
    fields['price/type'] = price.type;
    fields['price/currency'] = draft.currency;
    if (price.type === 'RANGE') {
      number('price/min', price.min);
      number('price/max', price.max);
    } else {
      if (!price.tiers.length) return fail('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
      for (const tier of price.tiers) {
        if (
          tier.quantity === null ||
          !/^[1-9][0-9]*$/u.test(tier.quantity) ||
          fields['price/tiers/' + tier.quantity] !== undefined
        )
          return fail('PRODUCT_MAINTENANCE_BASELINE_UNAVAILABLE');
        number('price/tiers/' + tier.quantity, tier.price);
      }
    }
  }
  return {
    productId: draft.productId,
    fields,
    fingerprint: await baselineFingerprint(draft.productId, fields)
  };
}
