# IOP price, absolute inventory and draft deletion

Checked 2026-10-30 against public cid=11 full JSON documentation. All examples in
`mock/data/product-maintenance-api.json` are synthetic; no account, credential,
browser, real business request or live write was used.

## Coverage and evidence

| Capability             | Native IOP path              | TOP coverage in this module                  | Risk     | Evidence                                              |
| ---------------------- | ---------------------------- | -------------------------------------------- | -------- | ----------------------------------------------------- |
| Set price              | /icbu/product/edit-price     | Not supported; no equivalence claimed        | mutation | documented, pure adapter tested                       |
| Set absolute inventory | /icbu/product/edit-inventory | Not supported; not the +/- inventory API     | mutation | documented, pure adapter tested                       |
| Delete known drafts    | /alibaba/icbu/draft/delete   | Not supported; never formal-product deletion | mutation | documented, pure adapter tested                       |
| Product readback       | /alibaba/icbu/product/get/v2 | Not supported by this native facade          | read     | documented; consumes ProductReferenceClient snapshots |

All four documents declare GET/POST, `chargeable:false`, `authType:1`.
Their common parameters require `app_key:String`, `timestamp:String`,
`access_token:String`, `sign_method:String`, `sign:String`. Timestamp documentation
allows less than 7200 seconds from UTC. This is authenticated IOP transport,
not permission/account acceptance. No entitlement, successful real write,
account verification or live readback is claimed. No TOP token/signature/path
substitution or protocol fallback exists.

Public document sources (GET only):

- [Price](https://openapi.alibaba.com/handler/share/apidoc/getApi.json?cid=11&path=%2Ficbu%2Fproduct%2Fedit-price&methodType=GET%2FPOST)
- [Inventory](https://openapi.alibaba.com/handler/share/apidoc/getApi.json?cid=11&path=%2Ficbu%2Fproduct%2Fedit-inventory&methodType=GET%2FPOST)
- [Draft deletion](https://openapi.alibaba.com/handler/share/apidoc/getApi.json?cid=11&path=%2Falibaba%2Ficbu%2Fdraft%2Fdelete&methodType=GET%2FPOST)
- [Product get/v2](https://openapi.alibaba.com/handler/share/apidoc/getApi.json?cid=11&path=%2Falibaba%2Ficbu%2Fproduct%2Fget%2Fv2&methodType=GET%2FPOST)

The parent's `docs/alibaba-product-workbench-docs.json` is a separate full
documentation snapshot, read-only to this sidecar.

## Full nested documented business fields

Notation: ! required in the public field table; ? optional. Generated examples
are not stronger than the field table. No undocumented maximum list size,
price scale or permission scope is invented.

### edit-price request

```text
product_id: Number!
price: Object?
  price_type: String? (TIERED | RANGE)
  currency: String? (USD only)
  tiered_price: Object[]?
    quantity: Number? (minimum quantity for this tier)
    price: String?
  range_price: Object?
    min_price: String?
    max_price: String?
sku_price: Object[]?
  sku_id: Number?
  price: String?
```

SPU price and SKU price are exclusive, and at least one is needed.
`B_PRICE_ALL_NULL` and `B_PRICE_CONFLICT` are documented errors. RANGE products
cannot be directly ordered by buyers. The tiered description says
`product_type`; the actual field is `price_type`, not a new product_type parameter.

Response, shared with edit-inventory:

```text
result: Object!
  data: Object! (documentation explicitly says null)
  success: Boolean!
  message: String! (failure detail)
  msg_code: String! (failure code)
```

The generated response example omits data, uses success:"true" and paradoxically
includes S_COMMON_INTERNAL_ERROR. We accept explicit boolean/string true only
with no conflicting code/data; that contradictory example is ambiguous, never
evidence of success. A valid acknowledgement is only accepted, not completed;
independent get/v2 readback remains required.

### edit-inventory request

```text
product_id: Number!
inventory: Number? (absolute SPU stock)
sku_inventory: Object[]?
  sku_id: Number?
  inventory: Number? (absolute SKU stock)
```

SPU and SKU forms are exclusive and cannot both be absent.
`B_INVENTORY_ALL_NULL` and `B_INVENTORY_CONFLICT` are documented.
The long description shows a map such as SKU-ID to quantity, but the full
Object[] children, Java service type List<SkuInfo>, and generated SDK requests
all specify an array with sku_id and inventory. This module only builds
that structured array; it rejects a map, raw JSON, delta, inventory-code
fields and unknown keys. It never calls the existing increment/decrement API.
Inventory is an unsigned integer quantity bounded by Java Long max locally.

### draft/delete request and response

```text
request:
  product_id_list: Number[]! (draft IDs, despite the parameter name)
response:
  deleted_draft_ids: Number[]! (successfully deleted draft IDs)
  success: Boolean! (true only if all drafts were deleted)
  message: String!
  msg_code: String!
  errors: Object[]!
    draft_id: Object! (documented as Object, not Number)
    errors: Object[]!
      message: String!
      msg_code: String!
```

These are root fields, not result fields. Single-item deletion is the default.
A batch requires allowBatch:true and every ID must match a trusted known draft
reference. A formal product ID, even a syntactically valid ID, is not proof
of a draft. The service replaces client-supplied provenance with trusted
runtime list/create records, then rechecks membership immediately before send.

Only a matching deleted_draft_ids entry yields reported-deleted for that ID.
Partial lists remain partial even if success:true. Unknown, duplicate or unsafe
IDs, contradictory error entries or HTTP-only success never become acceptance.
An opaque Object draft_id cannot safely identify an item. If a transport
provides an explicit safe scalar ID and detailed errors, that item can be
classified rejected; object errors stay uncorrelated and missing batch IDs
stay ambiguous. No raw provider error message is exposed or persisted.

### get/v2 request and complete business response

```text
request:
  product_id: Number?
  sku_id: Number?
response:
  product_info: Object!
    basic_info: Object?
      product_id: Number?
      title: String?
      keywords: String?
      description: String?
      product_images: Object[]?
        image_url: String?
      language: String? (currently en_US)
      create_timestamp: Number?
      last_modified_timestamp: Number?
      owner_ali_id: Number? (subaccounts isolated)
      status: String? (online | offline | deleted)
      audit_status: String? (approved | pending | rejected)
      model_number: String?
    category_info: Object?
      category_id: Number?
      category_name: String? (full category path separated by /)
      attributes: Object[]?
        attribute_name: String?
        attribute_value: String?
    logistics_info: Object?
      shipping_template_id: Number?
      weight: String? (kg, includes inner packaging)
      desi: String? (Turkiye only dimensional weight)
      dimension: Object?
        length: String? (cm)
        width: String? (cm)
        height: String? (cm)
      tiered_lead_time: Object[]?
        quantity: Number?
        lead_time: Number? (working days)
    trade_info: Object?
      moq: Number?
      unit: String?
      price: Object?
        price_type: String? (TIERED | RANGE)
        currency: String? (ISO 4217)
        range_price: Object?
          min_price: String?
          max_price: String?
        tiered_price: Object[]?
          quantity: Number?
          price: String?
      inventory: String? (SPU)
      sku_info: Object[]?
        sku_id: Number?
        sku_code: String?
        sku_price: Object?
          price: String?
          currency: String? (ISO 4217)
        inventory: String?
        sale_attributes: Object[]?
          attribute_name: String?
          attribute_value: String?
          image: Object?
            image_url: String?
  success: Boolean!
  message: String!
  msg_code: String!
```

At least productId or skuId is required by the business description/error code,
even though both fields are marked optional. Errors include
B_PRODUCT_PARAM_INVALID, B_PRODUCT_NOT_FOUND, S_PRODUCT_SEARCH_ERROR.
This facade's readback consumes ProductReferenceClient.getProduct(productId),
not a shop-wide scan. Native code/request_id appear in generated examples as
IOP envelope fields, not as additional business success evidence. A missing
product or a failed product query does not prove that a draft was deleted.

## Domain and adapter integration

`product-maintenance-api.ts` exports:

- PRODUCT_MAINTENANCE_METHODS: setPrice, setInventory, deleteDraft.
- ProductPriceDraft: operation:setPrice, productId; mode:tiered with USD/tiers,
  range with USD/minPrice/maxPrice, or sku with explicit currency/skus.
- ProductInventoryDraft: operation:setInventory, productId; mode:spu with inventory
  or sku with skus. All quantities and IDs are decimal strings.
- ProductDraftDeleteDraft: operation:deleteDraft, draftIds, knownDrafts,
  optional allowBatch:true. KnownProductDraft is kind:draft, draftId,
  source:draft-list or draft-create.
- buildProductPriceRequest, buildProductInventoryRequest,
  buildProductDraftDeleteRequest; the corresponding validate*Draft predicates.
- createProductMaintenanceIntent and canonicalizeProductMaintenanceDraft.
- classifyProductMaintenanceResponse/Error.
- comparePriceReadback and compareInventoryReadback.
- ProductMaintenanceAdapter(client, coordinator).execute(intent).

Builders preserve only intended keys and reject unknown fields, unsupported
combinations, numeric/unsafe IDs, floats, exponent money and unstructured JSON.
IDs/counts are exact canonical decimal strings bounded by signed Java Long.
Prices use exact nonnegative decimal strings, never floating math or rounding.
Tier quantities must be positive and strictly increasing. These local safety
requirements are stricter than optionality in the docs; they are not claims
about undocumented server validation. No currency is guessed. SPU currency must
be explicit USD. SKU currency is metadata only: the documented sku_price wire
object has no currency field, so an existing get/v2 SKU currency must match
the explicit draft currency before dispatch.

The adapter requires ProductMaintenanceCoordinator.run(intent, sendOnce).
The coordinator must durably persist/claim, bind account/credential context,
check per-method flags and authorization, and prohibit replay before invoking
sendOnce with protocol:iop, persistedIntentId and exact fingerprint.
For SKU prices, permit.reference is additionally required. The callback is
one-shot even on failure. The coordinator must persist and return the same
receipt object; it cannot manufacture acceptance without sending.
Fingerprints are local integrity evidence, not provider idempotency keys.

Receipts contain only operation/protocol/status/reason/readbackRequired and
optional per-draft item statuses. There is no raw response, secret, provider
message, completed flag, automatic retry or uncontrolled generic call method.

## Persistent core service

`product-maintenance-service.ts` adds ProductMaintenanceService, task/record/runtime
types, ProductMaintenanceRepository, parseProductMaintenanceRecord,
createProductMaintenanceBaseline, productMaintenanceLockEntities and
productMaintenanceIsTerminal. Parent owns SQL/D1/IndexedDB persistence,
public contracts, runtime credential selection, flags, routes, client and UI.

Final agreed request shape:

```ts
service.execute(ownerId, {
  requestId,
  context, // ProductOperationContext: opaque identity/gateway hashes, no credentials
  // exactly one:
  command: { action: 'create', draft }
  // or get(taskId), list(), send(taskId, revision, fingerprint),
  // verify(taskId, revision), cancel(taskId, revision)
}); // Promise<{ tasks: ProductMaintenanceTask[] }>
```

Resolver(context, requestId, intent, phase:prepare|send|verify) returns
context, protocol, enabled, client and optional readProduct/knownDrafts/readDrafts.
Only the actual method/payload is selected; a saved account/protocol context
must match again before dispatch or verification. Local get/list/cancel do not
require provider requests or authorization. TOP cannot execute these writes.

Create stores a minimal baseline for price/inventory only: productId, canonical
target-field scalar map and SHA-256. It never persists a full ProductReference.
SPU price baseline covers its existing type/currency/tier or range state; SKU
price/inventory baseline covers only selected SKUs. Before dispatch a fresh
get/v2 projection must match the baseline exactly; change or unavailable data
blocks sending before claim. Unrelated fields do not block the operation.
This read/compare/write sequence cannot eliminate an external writer racing
after the final read: the public APIs document no conditional write version.

Repository.save(record, expectedRevision|null) must be an atomic insert/CAS
AND enforce ownerId + context.identity + context.gateway + entity exclusivity.
Price/inventory share product:<id>; each deletion locks draft:<id>.
prepared/dispatching/accepted/partial/ambiguous retain all locks. Only
verified/rejected/cancelled release them. No memory fallback or expired-claim
resend is allowed.

Before calling the platform the service CAS-saves dispatching with
submitAttempted:true. A crash, network uncertainty or failed receipt save
cannot clear that barrier. A later request can verify, never resend.
Acknowledgement and readback remain separate: accepted is not verified.
Verification uses a fresh ProductReference snapshot or explicit bounded
per-draft absence evidence; query failure, incomplete list, duplicate IDs or
unknown status never prove absence. verified means the intended state was
observed, not proof of causation or an account-wide acceptance certification.
Original ambiguous/partial receipts are retained after successful verification.

## Verification scope

Only owned-file formatting/lint/type diagnostics and the two new Vitest suites
are run. Tests use synthetic JSON and a CAS/lock simulation; they do not
certify the parent's actual SQLite/D1/IndexedDB implementation, routes, browser,
permissions, real provider writes, production deployment or live readback.
Manifest version remains 2.20.2. No existing registry/contracts, package exports,
generators, global formatting, builds, commits or pushes are part of this sidecar.
