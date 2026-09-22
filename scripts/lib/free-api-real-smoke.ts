import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { isRecord, responseShape } from './product-stock-smoke';

export { responseShape };
export type Outcome =
  | 'passed'
  | 'no-data'
  | 'permission-denied'
  | 'skipped-prerequisite'
  | 'contract-drift'
  | 'provider-error'
  | 'result-unknown';
export interface Assessment {
  status: Outcome;
  reason: string;
  businessSuccess?: boolean;
  businessDataTrue?: boolean;
  requestId?: string;
}
export interface Definition {
  docId: number;
  method: string;
  risk: 'read' | 'mutation';
  requestParams: Param[];
  responseParams: Param[];
}
export interface Param {
  name: string;
  type: string;
  required: boolean;
  subParams?: Param[];
}
export interface Context {
  productId?: number;
  distributionSecretId?: string;
  topicId?: number;
  vendorOrderNo?: string;
  tradeId?: number | string;
  // Only supplied by an operator who has verified the actual business scenario, not the app display name.
  translationAppName?: string;
}
export type Plan = { kind: 'call'; parameters: Record<string, unknown> } | { kind: 'skip'; reason: string };
const call = (parameters: Record<string, unknown>): Plan => ({ kind: 'call', parameters });
const skip = (reason: string): Plan => ({ kind: 'skip', reason });

// Every method is independently reviewed. No suffix heuristic, demo-value fallback or global bypass.
export const READ_METHODS = new Set([
  'alibaba.icbu.distribution.product.query',
  'alibaba.icbu.distribution.product.get',
  'alibaba.icbu.industry.topic.list',
  'alibaba.icbu.topic.products',
  'alibaba.icbu.product.id.encrypt',
  'alibaba.icbu.trade.assurance.account.get',
  'alibaba.seller.vendor.order.list',
  'alibaba.seller.vendor.order.detail',
  'alibaba.seller.vendor.service.process',
  'alibaba.seller.vendor.service.vendorprocess',
  'alibaba.seller.vendor.trade.purchase',
  'alibaba.dropshipping.product.get',
  'alibaba.order.logistics.tracking.get',
  'alibaba.order.pay.result.query',
  'alibaba.icbu.text.recognize',
  'alibaba.icbu.text.recognize.trans',
  'alibaba.icbu.shopclone.icbuproductrights.query',
  'alibaba.icbu.shopclone.icbushopinfo.query',
  'alibaba.icbulive.productlist.pageget',
  'alibaba.icbu.product.logistics.country.getcoststatus',
  'alibaba.shipping.freight.calculate',
  'alibaba.order.freight.calculate',
  'alibaba.seller.coupon.auth.verify',
  'alibaba.onetouch.logistics.express.logistics.solution.semi.list',
  // Read-only prerequisite discovery, independently allowlisted at the command line too.
  'alibaba.icbu.product.list',
  'alibaba.icbu.product.inventory.get',
  'alibaba.icbu.product.sku.inventory.get',
  'alibaba.seller.order.list',
  'alibaba.icbu.video.query'
]);
export const WRITE_METHODS = new Set([
  'alibaba.icbu.product.inventory.update',
  'alibaba.icbu.video.upload',
  'alibaba.dropshipping.token.create',
  'alibaba.dropshipping.store.save',
  'alibaba.buynow.order.create',
  'alibaba.dropshipping.order.pay',
  'alibaba.icbu.shopclone.externalproductinfo.write',
  'alibaba.icbu.shopclone.externalshopinfo.write',
  'alibaba.icbu.supplierfoster.isvtask.notify',
  'alibaba.icbulive.product.push',
  'alibaba.seller.vendor.write.client'
]);

export const BLOCKERS: Record<string, string> = {
  'alibaba.icbu.product.logistics.country.getcoststatus':
    'Need an actual shipping_template_id plus the same product unit_weight, unit_size, sale_type, product_type and moq; no template ID or dimensions inferred from examples.',
  'alibaba.shipping.freight.calculate':
    'Need a real dropshipping product and intended destination_country and quantity; no invented destination or purchase intent.',
  'alibaba.order.freight.calculate':
    'Need e_company_id from the actual dropshipping product response, its SKU, intended quantity and destination_country.',
  'alibaba.onetouch.logistics.express.logistics.solution.semi.list':
    'Need an owned semi-managed trade_order_id AND its actual supply_chain_biz_id (shipment batch); ordinary order IDs are not interchangeable.',
  'alibaba.icbu.shopclone.icbuproductrights.query':
    'Need the account_id returned by the shopclone authorization flow, not an appKey, seller memberId or guessed numeric identity.',
  'alibaba.icbu.shopclone.icbushopinfo.query':
    'Need the shopclone-authorized account_id and registered service_code for this store migration service.',
  'alibaba.icbulive.productlist.pageget':
    'Need an owned live_uuid and authenticated ali_id for that room; no browser-cookie identity invented.',
  'alibaba.dropshipping.product.get':
    'Need an actual dropshipping-selection product ID; a seller catalog product is not evidence of dropshipping eligibility.',
  'alibaba.seller.vendor.trade.purchase':
    'Need the actual buyer_login_id and registered service_code to query existing purchased services; no fake buyer identity.',
  'alibaba.icbu.product.inventory.update':
    'Need a currently readable owned product/SKU/warehouse baseline with explicit quantity before plus1/readback/sub1/readback.',
  'alibaba.icbu.video.upload':
    'Need one owned nonsensitive test-media URL already hosted in authorized test storage and verified media provenance; no new public storage or copied customer video.',
  'alibaba.dropshipping.store.save':
    'Need the real owned external store_type and store_url and current binding baseline; do not invent a store or overwrite an unknown binding.',
  'alibaba.buynow.order.create':
    'At order creation: need a real intended purchase, source channel_refer_id, actual supplier product/SKU/price/quantity, recipient address and quoted carrier/fee. Creation affects the supplier account; stop before submitting absent this business authorization.',
  'alibaba.dropshipping.order.pay':
    'At payment submission: need an actual owned payable order and authorized CREDIT_CARD/PAYPAL funding. This step may debit real money; no payment submitted and no official sandbox established.',
  'alibaba.icbu.shopclone.externalproductinfo.write':
    'Need registered vendor_company_name/service_code, shopclone-authorized account_id, verified source shop/product provenance and matching published ICBU product ID.',
  'alibaba.icbu.shopclone.externalshopinfo.write':
    'Need verified owned source shop, registered vendor legal name, authorized account_id, existing binding state and genuine user-confirmation time.',
  'alibaba.icbu.supplierfoster.isvtask.notify':
    'Need a real assigned ISV task_key, actual result and billing agreement. deduction/no_tax_deduction can affect settlement; stop before reporting any fictitious task or charge.',
  'alibaba.icbulive.product.push':
    'Need an owned active live_uuid, its authenticated ali_id, real room product and confirmed audience impact; no push into another account or unknown live session.',
  'alibaba.seller.vendor.write.client':
    'Need registered app_id/service_code, actual customer record, real phone, recorder and service event; no fake identity/contact or fabricated service history.',
  'alibaba.seller.coupon.auth.verify':
    'Need a real owned coupon_seq_number and registered service_code plus verification-versus-redemption semantics; no invented coupon and no unconfirmed consumption.'
};

export function planRead(method: string, c: Context): Plan {
  switch (method) {
    case 'alibaba.icbu.product.list':
      return call({ current_page: 1, page_size: 10, language: 'ENGLISH' });
    case 'alibaba.seller.order.list':
      return call({ param_trade_ecology_order_list_query: { role: 'seller', start_page: 0, page_size: 10 } });
    case 'alibaba.icbu.distribution.product.query':
      return call({ pool_product_page_query: { current_page: 1, page_size: 10 } });
    case 'alibaba.icbu.industry.topic.list':
      return call({ current_page: 1, page_size: 10 });
    case 'alibaba.icbu.trade.assurance.account.get':
      return call({});
    case 'alibaba.seller.vendor.order.list':
      return call({ query_trade_dto: { page: 1, page_size: 10, off_set: 0, length: 10 } });
    case 'alibaba.icbu.distribution.product.get':
      return c.distributionSecretId
        ? call({ product_get_request: { secret_id: c.distributionSecretId } })
        : skip(
            'Need secret_id returned by this run of distribution.product.query; no seller-ID substitution.'
          );
    case 'alibaba.icbu.topic.products':
      return c.topicId
        ? call({ topic_id: c.topicId, current_page: 1, page_size: 10 })
        : skip('Need a topic id returned by industry.topic.list.');
    case 'alibaba.icbu.product.id.encrypt':
      return c.productId
        ? call({ product_id: c.productId, language: 'en_US' })
        : skip('Need a real product id returned by the owned product list.');
    case 'alibaba.icbu.product.inventory.get':
    case 'alibaba.icbu.product.sku.inventory.get':
      return c.productId
        ? call({ product_id: c.productId, language: 'en_US' })
        : skip('Need a product id returned by the owned product list.');
    case 'alibaba.seller.vendor.order.detail':
      return c.vendorOrderNo
        ? call({ order_no: c.vendorOrderNo })
        : skip('Need an actual service-market order_no from vendor.order.list.');
    case 'alibaba.seller.vendor.service.process':
    case 'alibaba.seller.vendor.service.vendorprocess':
      return c.vendorOrderNo
        ? call({ order_num: c.vendorOrderNo })
        : skip(
            'Need an actual service-market order number; optional in schema does not establish a valid business query.'
          );
    case 'alibaba.order.logistics.tracking.get':
    case 'alibaba.order.pay.result.query':
      return c.tradeId
        ? call({ trade_id: c.tradeId })
        : skip('Need an owned order trade_id returned by the authorized order list; no dummy order created.');
    case 'alibaba.icbu.text.recognize':
      return c.translationAppName
        ? call({
            icbu_language_recognize_task_dto: {
              app_name: c.translationAppName,
              trans_engine: 'ALI_TRANS',
              text: 'A cotton T-shirt.'
            }
          })
        : skip(
            'Need a registered translation business app_name; OAuth application display name is not this prerequisite.'
          );
    case 'alibaba.icbu.text.recognize.trans':
      return c.translationAppName
        ? call({
            icbu_recognize_and_translate_task_dto: [
              {
                app_name: c.translationAppName,
                trans_engine: 'ALI_TRANS',
                source_text: 'A cotton T-shirt.',
                target_language: 'es',
                format: 'text',
                field_type: 'title'
              }
            ]
          })
        : skip('Need a registered translation business app_name; no arbitrary appName probe.');
    default:
      return skip(BLOCKERS[method] ?? 'Method has no individually reviewed real-business request planner.');
  }
}

export function authorize(
  method: string,
  mode: 'read' | 'write',
  options: {
    read: boolean;
    write: boolean;
    allow: ReadonlySet<string>;
  }
): void {
  if (
    !options[mode] ||
    !options.allow.has(method) ||
    !(mode === 'read' ? READ_METHODS : WRITE_METHODS).has(method)
  ) {
    throw new Error('METHOD_NOT_OPTED_IN');
  }
}
export function safeId(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
/** Identify lossless scalar order-ID representations, never a validator exception.
 * The runner must pass the generated AJV safe-integer-or-decimal-string request contract.
 * Mutation parameters, exponents, signs, unsafe JS numbers and arbitrary fields remain rejected.
 */
export function losslessOrderWireParameters(method: string, parameters: Record<string, unknown>): boolean {
  return (
    ['alibaba.order.logistics.tracking.get', 'alibaba.order.pay.result.query'].includes(method) &&
    Object.keys(parameters).length === 1 &&
    typeof parameters.trade_id === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(parameters.trade_id) &&
    BigInt(parameters.trade_id) <= 9223372036854775807n
  );
}
export function object(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
export function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const children = Object.values(object(value));
  return children.length === 1 && Array.isArray(children[0]) ? children[0] : [];
}
export function unwrap(method: string, value: unknown): Record<string, unknown> {
  const root = object(value);
  const key = `${method.replaceAll('.', '_')}_response`;
  return isRecord(root[key]) ? root[key] : root;
}
export function collectContext(method: string, value: unknown, c: Context): Context {
  const root = unwrap(method, value);
  if (method === 'alibaba.icbu.product.list') {
    const first = object(array(root.products)[0]);
    const id = safeId(first.id ?? first.product_id);
    return { ...c, ...(id ? { productId: id } : {}) };
  }
  if (method === 'alibaba.icbu.distribution.product.query') {
    const id = object(array(root.products)[0]).secret_id;
    return { ...c, ...(typeof id === 'string' && id.length > 0 ? { distributionSecretId: id } : {}) };
  }
  if (method === 'alibaba.icbu.industry.topic.list') {
    const id = safeId(object(array(root.datas)[0]).id);
    return { ...c, ...(id ? { topicId: id } : {}) };
  }
  if (method === 'alibaba.seller.vendor.order.list') {
    const id = object(array(object(root.result).dtos)[0]).order_no;
    return { ...c, ...(typeof id === 'string' && id.length > 0 ? { vendorOrderNo: id } : {}) };
  }
  // Seller list structure is explicitly documented; never recursively harvest arbitrary id fields.
  if (method === 'alibaba.seller.order.list') {
    const first = object(array(object(object(root.result).value).order_list)[0]);
    const rawId = first.trade_id ?? first.order_id;
    const id =
      safeId(rawId) ??
      (typeof rawId === 'string' &&
      losslessOrderWireParameters('alibaba.order.pay.result.query', { trade_id: rawId })
        ? rawId
        : undefined);
    return { ...c, ...(id ? { tradeId: id } : {}) };
  }
  return c;
}

const SUCCESS_FIELDS = new Set([
  'success',
  'successful',
  'successed',
  'is_success',
  'biz_success',
  'call_success',
  'recognize_success'
]);
const ERROR_FIELDS = new Set([
  'error_code',
  'error_type',
  'errcode',
  'msg_code',
  'inner_error_code',
  'return_code',
  'result_code',
  'recognize_error_code'
]);
// Persist only an allowlisted diagnostic code, never provider messages, request IDs or arbitrary strings.
const KNOWN_CODES =
  /^(?:[0-9]{1,6}|(?:isv|isp)\.(?:permission-api-package-limit|invalid-permission|invalid-parameter|missing-parameter|invalid-session|invalid-authorization)|REQUEST_TIMEOUT|NETWORK_ERROR|UPSTREAM_UNAVAILABLE|INVALID_JSON_RESPONSE|AUTHENTICATION_FAILED|PERMISSION_DENIED|RATE_LIMITED|LOCAL_ERROR)$/;
export function diagnosticCode(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return KNOWN_CODES.test(text) ? text : 'REDACTED_PROVIDER_CODE';
}
export function assess(method: string, value: unknown, contractValid: boolean, write = false): Assessment {
  const root = unwrap(method, value);
  const evidence = { positive: false, negative: false, permission: false };
  function visit(v: unknown, depth = 0): void {
    if (depth > 8) return;
    if (Array.isArray(v)) {
      v.slice(0, 30).forEach((child) => {
        visit(child, depth + 1);
      });
      return;
    }
    for (const [key, child] of Object.entries(object(v))) {
      if (SUCCESS_FIELDS.has(key)) {
        evidence.positive ||= child === true;
        evidence.negative ||= child === false;
      }
      if (ERROR_FIELDS.has(key)) {
        const rawCode = isRecord(child) ? child.code : child;
        const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : '';
        if (code !== '' && !['0', '200', '0000', 'SUCCESS', 'success'].includes(code)) {
          evidence.negative = true;
          evidence.permission ||=
            /permission|forbidden|auth|token|session|scope/i.test(code) || code === '11';
        }
      }
      visit(child, depth + 1);
    }
  }
  visit(root);
  if (evidence.negative)
    return {
      status: evidence.permission ? 'permission-denied' : 'provider-error',
      reason: 'BUSINESS_REJECTED'
    };
  if (!contractValid || Object.keys(root).filter((k) => !/^(request_id|trace_id)$/.test(k)).length === 0) {
    return {
      status: write ? 'result-unknown' : 'contract-drift',
      reason: 'RESPONSE_CONTRACT_INVALID_OR_EMPTY'
    };
  }
  if (method === 'alibaba.dropshipping.token.create')
    evidence.positive = typeof root.ecology_token === 'string' && root.ecology_token.length > 0;
  if (method === 'alibaba.icbu.video.upload') evidence.positive = root.msg_code === '200';
  if (method === 'alibaba.icbu.product.inventory.update')
    evidence.positive =
      object(root.result).success === true &&
      ['true', true].includes(object(root.result).data as string | boolean);
  if (write)
    return {
      status: evidence.positive ? 'passed' : 'result-unknown',
      reason: evidence.positive ? 'BUSINESS_ACKNOWLEDGED' : 'MISSING_WRITE_ACKNOWLEDGEMENT'
    };
  const collections: Record<string, unknown> = {
    'alibaba.icbu.product.list': root.products,
    'alibaba.icbu.industry.topic.list': root.datas,
    'alibaba.icbu.topic.products': root.datas,
    'alibaba.icbu.distribution.product.query': root.products,
    'alibaba.seller.vendor.order.list': object(root.result).dtos,
    'alibaba.seller.order.list': object(object(root.result).value).order_list,
    'alibaba.icbu.product.inventory.get': object(root.result).data_list,
    'alibaba.icbu.product.sku.inventory.get': object(root.result).data_list
  };
  if (Object.hasOwn(collections, method)) {
    const collection = collections[method];
    const count =
      root.total_item ??
      root.record_count ??
      object(root.result).total_count ??
      object(object(root.result).value).total_count ??
      root.total_count;
    if (collection === undefined && count !== 0)
      return { status: 'contract-drift', reason: 'MISSING_DATA_COLLECTION' };
    if (
      collection !== undefined &&
      !Array.isArray(collection) &&
      !Object.values(object(collection)).some(Array.isArray)
    )
      return { status: 'contract-drift', reason: 'INVALID_DATA_COLLECTION' };
    if (array(collection).length === 0)
      return { status: 'no-data', reason: 'EMPTY_COLLECTION_NOT_ZERO_INVENTORY' };
  }
  return { status: 'passed', reason: 'RESPONSE_ACCEPTED' };
}
export function assessError(error: unknown, write = false): Assessment & { code: string } {
  const e = object(object(error).gatewayError);
  const code = e.subCode ?? e.code;
  const raw = typeof code === 'string' || typeof code === 'number' ? String(code) : 'LOCAL_ERROR';
  const permission = /permission|forbidden|auth|token|session|credential/i.test(raw) || e.code === '11';
  // A numeric TOP "remote service error" is not proof that a mutation was never executed.
  const rejected = permission || /^isv\.(?:invalid|missing)-parameter$/.test(raw);
  return {
    status: permission ? 'permission-denied' : write && !rejected ? 'result-unknown' : 'provider-error',
    reason: write && !rejected ? 'DISPATCH_RESULT_UNKNOWN_DO_NOT_RETRY' : 'CALL_REJECTED',
    code: diagnosticCode(raw)
  };
}

export class SequentialCalls {
  private tail: Promise<unknown> = Promise.resolve();
  private lastFinished = 0;
  constructor(
    private readonly spacing = 350,
    private readonly wait: (milliseconds: number) => Promise<unknown> = setTimeout,
    private readonly now = Date.now
  ) {
    if (spacing < 350) throw new Error('MINIMUM_SPACING_350MS');
  }
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const delay = Math.max(0, this.spacing - (this.now() - this.lastFinished));
      if (delay) await this.wait(delay);
      try {
        return await fn();
      } finally {
        this.lastFinished = this.now();
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
// Immutable, fsync'd intent is created exclusively BEFORE dispatch. Any previous intent, including
// a completed or interrupted one, blocks replay. No --force, --retry or run-id-based bypass.
export class WriteReceipts {
  constructor(private readonly directory: string) {}
  async unresolved(): Promise<{ method: string; key: string }[]> {
    await mkdir(this.directory, { recursive: true });
    const files = await readdir(this.directory);
    const unresolved: { method: string; key: string }[] = [];
    for (const file of files.filter((f) => f.endsWith('.intent.json'))) {
      const intent = object(JSON.parse(await readFile(resolve(this.directory, file), 'utf8')) as unknown);
      const key = typeof intent.key === 'string' ? intent.key : '';
      const method = typeof intent.method === 'string' ? intent.method : '';
      if (!/^[a-f0-9]{64}$/.test(key) || !WRITE_METHODS.has(method)) throw new Error('INVALID_WRITE_RECEIPT');
      // Only proven restoration supersedes unknown status, never a skipped restoration attempt.
      let restored = false;
      const delayedFile = `${key}.delayed-restoration-result.json`;
      const subFile = `${key}.sub-result.json`;
      const readbackFile = `${key}.delayed-sub-readback.json`;
      if (
        method === 'alibaba.icbu.product.inventory.update' &&
        [delayedFile, subFile, readbackFile].every((name) => files.includes(name))
      ) {
        const delayed = object(
          JSON.parse(await readFile(resolve(this.directory, delayedFile), 'utf8')) as unknown
        );
        const sub = object(JSON.parse(await readFile(resolve(this.directory, subFile), 'utf8')) as unknown);
        const readback = object(
          JSON.parse(await readFile(resolve(this.directory, readbackFile), 'utf8')) as unknown
        );
        const baseline = object(intent.recovery).baseline;
        restored =
          delayed.status === 'passed' &&
          delayed.reason === 'DELAYED_PLUS_ONE_SUB_ONE_NEW_BASELINE_RESTORED' &&
          sub.status === 'passed' &&
          Array.isArray(baseline) &&
          baseline.length > 0 &&
          JSON.stringify(readback.inventory) === JSON.stringify(baseline);
      }
      const final = restored
        ? delayedFile
        : files.includes(`${key}.cycle-result.json`)
          ? `${key}.cycle-result.json`
          : `${key}.result.json`;
      const result = files.includes(final)
        ? object(JSON.parse(await readFile(resolve(this.directory, final), 'utf8')) as unknown)
        : {};
      const status = typeof result.status === 'string' ? result.status : '';
      if (
        !['passed', 'permission-denied', 'provider-error', 'skipped-prerequisite', 'contract-drift'].includes(
          status
        )
      )
        unresolved.push({ method, key });
    }
    return unresolved;
  }
  async begin(
    method: string,
    identity: unknown,
    recovery?: { productId: number; baseline: InventoryCell[] }
  ): Promise<{
    record: (phase: string, assessment: Assessment, inventory?: InventoryCell[] | null) => Promise<void>;
  }> {
    if (
      method === 'alibaba.icbu.product.inventory.update' &&
      (!recovery || !safeId(recovery.productId) || !recovery.baseline.length)
    )
      throw new Error('INVENTORY_RECOVERY_BASELINE_REQUIRED');
    const key = fingerprint([method, identity]);
    const path = resolve(this.directory, `${key}.intent.json`);
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({
          method,
          key,
          phase: 'intent-before-dispatch',
          createdAt: new Date().toISOString(),
          ...(recovery ? { recovery } : {})
        })
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    return {
      record: async (phase, assessment, inventory) => {
        if (!/^[a-z0-9-]+$/.test(phase)) throw new Error('INVALID_RECEIPT_PHASE');
        const event = await open(resolve(this.directory, `${key}.${phase}.json`), 'wx', 0o600);
        try {
          await event.writeFile(
            JSON.stringify({
              method,
              key,
              phase,
              ...assessment,
              ...(inventory !== undefined ? { inventory } : {}),
              recordedAt: new Date().toISOString()
            })
          );
          await event.sync();
        } finally {
          await event.close();
        }
      }
    };
  }
}
export async function readOwnedVideoManifest(
  path: string
): Promise<{ url: string; name: string; sha256: string } | null> {
  const v: unknown = JSON.parse(await readFile(path, 'utf8'));
  const m = object(v);
  if (
    m.owned !== true ||
    m.nonsensitive !== true ||
    m.authorizedTestStorage !== true ||
    m.alreadyHosted !== true ||
    !/^[a-f0-9]{64}$/.test(String(m.sha256))
  )
    return null;
  if (typeof m.url !== 'string' || typeof m.name !== 'string' || !m.name.startsWith('OV-FREE-API-TEST-'))
    return null;
  const url = new URL(m.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !Array.isArray(m.allowedStorageOrigins) ||
    !m.allowedStorageOrigins.includes(url.origin)
  )
    return null;
  return { url: m.url, name: m.name, sha256: String(m.sha256) };
}

export interface InventoryCell {
  skuId: number;
  code: string;
  quantity: number;
}
export function inventoryCells(value: unknown): InventoryCell[] | null {
  const result = object(object(value).result);
  if (
    result.success !== true ||
    (result.msg_code !== undefined && result.msg_code !== '') ||
    !Array.isArray(result.data_list)
  )
    return null;
  const cells: InventoryCell[] = [];
  for (const v of result.data_list) {
    const r = object(v);
    if (
      !Number.isSafeInteger(r.sku_id) ||
      (Number(r.sku_id) < 1 && r.sku_id !== -1) ||
      typeof r.inventory_code !== 'string' ||
      !r.inventory_code ||
      !Number.isSafeInteger(r.inventory) ||
      Number(r.inventory) < 0 ||
      Number(r.inventory) >= Number.MAX_SAFE_INTEGER
    )
      return null;
    const cell = { skuId: Number(r.sku_id), code: r.inventory_code, quantity: Number(r.inventory) };
    if (cells.some((c) => c.skuId === cell.skuId && c.code === cell.code)) return null;
    cells.push(cell);
  }
  return cells.sort((a, b) => a.skuId - b.skuId || a.code.localeCompare(b.code));
}
export async function inventoryRoundTrip(input: {
  baseline: InventoryCell[];
  read: (phase: 'baseline' | 'after-plus' | 'after-sub') => Promise<InventoryCell[] | null>;
  write: (operate: 'plus' | 'sub', cell: InventoryCell) => Promise<Assessment>;
  record: (phase: string, assessment: Assessment, inventory?: InventoryCell[] | null) => Promise<void>;
}): Promise<Assessment> {
  const cell = input.baseline[0];
  if (!cell) return { status: 'skipped-prerequisite', reason: 'NO_KNOWN_INVENTORY_BASELINE' };
  const verifiedBaseline = await input.read('baseline');
  await input.record(
    'baseline-verified',
    { status: 'passed', reason: 'BASELINE_READBACK_BEFORE_DISPATCH' },
    verifiedBaseline
  );
  if (JSON.stringify(verifiedBaseline) !== JSON.stringify(input.baseline))
    return { status: 'skipped-prerequisite', reason: 'BASELINE_CHANGED_BEFORE_WRITE' };
  await input.record('plus-intent', { status: 'result-unknown', reason: 'PLUS_ONE_DISPATCH_INTENT' });
  const plus = await input.write('plus', cell);
  await input.record('plus-result', plus);
  if (plus.status !== 'passed') return plus;
  const expected = input.baseline.map((c, i) => (i === 0 ? { ...c, quantity: c.quantity + 1 } : c));
  const afterPlus = await input.read('after-plus');
  await input.record(
    'plus-readback',
    { status: 'result-unknown', reason: 'OBSERVED_INVENTORY_AFTER_PLUS' },
    afterPlus
  );
  if (JSON.stringify(afterPlus) !== JSON.stringify(expected))
    return { status: 'result-unknown', reason: 'PLUS_READBACK_MISMATCH_STOP_NO_BLIND_SUBTRACTION' };
  await input.record('sub-intent', {
    status: 'result-unknown',
    reason: 'VERIFIED_PLUS_ONE_SUBTRACTION_INTENT'
  });
  const sub = await input.write('sub', cell);
  await input.record('sub-result', sub);
  if (sub.status !== 'passed')
    return {
      status: 'result-unknown',
      reason: 'RESTORE_NOT_CONFIRMED_AFTER_PLUS_MANUAL_RECONCILIATION_REQUIRED'
    };
  const afterSub = await input.read('after-sub');
  await input.record(
    'sub-readback',
    { status: 'result-unknown', reason: 'OBSERVED_INVENTORY_AFTER_SUB' },
    afterSub
  );
  return JSON.stringify(afterSub) === JSON.stringify(input.baseline)
    ? { status: 'passed', reason: 'PLUS_ONE_READBACK_SUB_ONE_BASELINE_RESTORED' }
    : { status: 'result-unknown', reason: 'RESTORE_READBACK_MISMATCH_MANUAL_RECONCILIATION_REQUIRED' };
}
