# Scoped inventory quantity evidence (read-only)

`assessAbsoluteInventoryEvidence(target, row)` consumes validated read metadata only.
Target is `{ productId, scope: 'spu' }` or `{ productId, scope: 'sku', skuId }`;
IDs are canonical positive decimal strings: productId keeps the existing
`freezeInventoryProductIds` MAX_SAFE_INTEGER limit; SKU IDs may reach Java Long.
It returns
`{ status: 'available', quantity: string }` or `unavailable` with a stable reason.
Available means quantity evidence for that scope, **not** writable, restorable,
authenticated, fresh, or task-verified. No write gate consumes this result.

## Protocol preflight

Existing method registry, capability contracts and protocol registration were
inspected; no API, adapter, authorization, CLI option or request is added.

| Sub-capability              | TOP method                                             | IOP public path                | Parameters / limits                                                                                                                                                              | Evidence / applicability                                                                                                                     |
| --------------------------- | ------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SPU / SKU absolute quantity | No equivalent reader evidence: `SOURCE_NOT_APPLICABLE` | `/alibaba/icbu/product/get/v2` | Existing diagnostic requests explicit `product_id`; assessment matches product ID. SPU uses only `trade_info.inventory`; SKU uses only target `trade_info.sku_info[].inventory`. | Existing documented/adapted IOP contract. Registry records historical account verification, not current permission or quantity completeness. |
| Warehouse inventory         | `alibaba.icbu.product.inventory.get`                   | `/icbu/product/inventory/get`  | Product ID, language, SKU and warehouse scope                                                                                                                                    | Documented/adapted, but `SOURCE_NOT_APPLICABLE` for absolute quantities. No sums, fallback or cross-protocol retry.                          |
| Schema quantities           | `alibaba.icbu.product.schema.render`                   | `/icbu/product/schema/render`  | Product ID, independently confirmed category and language                                                                                                                        | Existing diagnostic only; `SOURCE_NOT_APPLICABLE` for this assessor. No warehouse/srcValue/template fallback.                                |
| Local assessment            | Not required                                           | Not required                   | Metadata only; no authorization, network, clock or file calls                                                                                                                    | Synthetic offline tests only in this change.                                                                                                 |

IOP warehouse reader supports only `source=product`; `source=sku` is unsupported.
TOP separately has `alibaba.icbu.product.sku.inventory.get`: it is not the IOP
product-source reader and neither warehouse reader is absolute quantity evidence.

Source acceptance requires explicit `protocol: 'iop'`, `route: 'product'`, exact
get/v2 path, a nonempty valid diagnostic request ID, `accepted`, and both
`contractValid === true` and `businessSuccess === true`. Product IDs must match
target, row and response evidence; audit must be `approved`, platform `online`
or `offline`. Missing protocol metadata is not inferred from a path.

SKU assessment requires a present array, safe nonnegative count equal to retained
rows, positive unique SKU IDs throughout the entire list and the exact target.
The existing 500-row evidence cap therefore makes a truncated list unavailable,
even if its retained prefix contains the target. The `-1` sentinel is not a SKU.
Count equality only rules out truncation by this diagnostic; it does not prove
that the platform returned every SKU or a complete writable baseline.
SPU assessment never reads the SKU list; SKU assessment never uses SPU inventory.

Zero is evidence only when explicit. Missing/null/empty/negative/fractional,
unsafe numeric and above-Java-Long quantities are unavailable. Canonical Long
strings (including `9223372036854775807`) remain strings without precision loss.
An archived field must retain present/type/safeInteger metadata consistently.

The CLI attaches only an explicit `scope: 'spu'` assessment to each product row,
including failures, and adds `availableSpuQuantityEvidence` to its summary.
Original request statuses, accepted/failed/skipped counts, and network counts
retain their original meanings. No automatic per-SKU assessments are emitted.

## Acceptance boundary and stable reasons

TOP-only and legacy-unmarked TOP: not applicable. IOP-only and either dual-auth
default: assessment uses the row's explicit source, never switches protocols.
Earlier version-1 archives store protocol on the report. A caller may supply that
explicit saved report.protocol when assessing a historical row; it is never
inferred from a path or credential default.

Same-session controlled evidence (2026-11-02): one product, three accepted read-only
requests, no SPU quantity, empty SKU/warehouse lists and empty Schema quantities.
The assessor was checked against that redacted receipt and returned unavailable
with QUANTITY_MISSING, not zero, without new network calls or credential access.
Real receipts stay ignored and are not copied into synthetic fixtures. This is
not browser acceptance, inventory-write validation or a provider-completeness claim.

Reasons are checked in this order: `TARGET_INVALID`, `SOURCE_NOT_APPLICABLE`,
`SOURCE_PATH_MISMATCH`, `REQUEST_INVALID`, `REQUEST_NOT_ACCEPTED`,
`CONTRACT_INVALID`, `BUSINESS_UNSUCCESSFUL`, `PRODUCT_ID_MISMATCH`,
`AUDIT_NOT_APPROVED`, `PLATFORM_STATUS_UNSUPPORTED`, then scope-specific
`SKU_LIST_INVALID`, `SKU_LIST_INCOMPLETE`, `SKU_ID_INVALID`, `SKU_ID_DUPLICATE`,
`SKU_NOT_FOUND`, and finally `QUANTITY_MISSING` / `QUANTITY_INVALID`.
They are local evidence diagnostics, not upstream business errors or permissions.

## Workbench quantity readback (2026-11-02)

The same pure assessor now lives in
`packages/core/src/inventory-quantity-evidence.ts`. The diagnostic module
re-exports it for existing callers. It remains read-only evidence, never a write
permit or an automatic recovery baseline.

The existing `getProductInventory` operation adds an explicit
`source: "absolute"` option. It makes one native IOP get/v2 request for the
requested product. It does not silently augment warehouse reads, scan products,
or retry with TOP. TOP-only is rejected before network access with
`ALIBABA_IOP_AUTHORIZATION_REQUIRED`. In dual authorization, this source binds
the actual IOP context regardless of the saved default. Existing `product` and
`sku` sources retain their warehouse semantics; SKU warehouse reads require TOP.

The optional snapshot `quantityEvidence` separates SPU and individual SKU
quantities. Available rows contain an exact decimal string; unavailable rows
contain null plus a reason. The contract rejects contradictory states. Explicit
zero is retained, missing is never zero, long quantities are never coerced to JS
numbers, and SKU/warehouse quantities are never used as SPU substitutes. Existing
warehouse responses now reject fractional and unsafe numeric quantities.

The inventory page and the shared product inventory drawer expose the new source,
scope, actual protocol, dated result, evidence count and unavailable reasons.
Source-specific contexts, in-flight work and five-minute memory caches are
isolated; pause/account changes prevent queued dispatch. Refresh failure keeps
the dated previous snapshot visibly separate from the failure.

A locally generated correlation ID associates the assessed quantity with the
current adapter read; it is not advertised as an upstream trace ID or proof of
authentication. The public `traceId` still comes only from the platform response.

### Current remote acceptance

Isolated Node BFF profiles confirmed TOP-only, IOP-only, dual TOP-default and
dual IOP-default routing with unchanged user configurations. The current controlled
product returned no warehouse records and no SPU quantity in all supported reads.
That is a valid unavailable result, not zero or a successful write baseline.
An older explicitly named inventory sample was no longer found by TOP; IOP did
not return a usable exact-product result. Neither sample was written.

Raw receipts, temporary encrypted profiles and screenshots remain under the
ignored `artifacts/inventory-ui-20261102/` directory. No secrets, complete product
responses or account-specific quantity baselines are committed. UI/formal MV3
results and automated check counts are recorded there independently; Node API
success alone is not browser or extension acceptance.

Formal MV3 page acceptance also completed in all four isolated configurations:
TOP-only, IOP-only, dual TOP-default and dual IOP-default. Each exercised the
inventory page and shared drawer with all three sources (12 display checks).
Supported requests returned legal empty results, not zero; unsupported sources
were refused with zero provider requests. No script errors or credential/default
changes were observed.

| Source                    | TOP-only                       | IOP-only                     | Either dual default |
| ------------------------- | ------------------------------ | ---------------------------- | ------------------- |
| Product warehouse records | TOP                            | IOP                          | IOP                 |
| SKU warehouse records     | TOP                            | Not mapped; no provider call | TOP                 |
| Scoped SPU/SKU quantities | Requires IOP; no provider call | IOP                          | IOP                 |

This acceptance exposed and fixed the extension options client's swallowed
context errors: a correlated gateway denial now preserves its reason and request
ID instead of becoming a generic context-unavailable error. Malformed or
mismatched responses still fail closed. A successful context lookup is metadata,
not proof that a subsequent business method is supported.

The temporary test profile pre-granted the exact IOP API origin; this is not a
new native permission-consent acceptance. The production manifest is unchanged.
Web E2E additionally checks explicit zero, long quantities, missing values,
source switching, English/dark/narrow layouts and the shared product drawer.

No inventory write whitelist, mutation flag, absolute set operation, automatic
retry or UI write action is enabled by this integration. The first two samples
did not permit a modify/readback/restore experiment because neither returned a
reliable current baseline.

### Nonempty follow-up and native numeric compatibility

A bounded first-page search and focused inventory/stock title searches found an
existing offline RTS candidate. TOP product and SKU warehouse reads, IOP product
warehouse reads and Schema each exposed the same explicit SKU/warehouse record.
Only returned identifiers were used; the shop was not scanned in full. All
account identifiers, quantities and raw receipts remain in the ignored directory.

The native get/v2 response failed validation solely at seven documented String
leaves that the platform actually returned as Number: weight, dimension
length/width/height, SPU inventory, SKU inventory and SKU price. The source
contract generator now allows String or Number only at these explicit get/v2
paths, retaining values without coercion. Search/v2 and unrelated fields are not
widened. The quantity assessor still rejects unsafe, fractional and negative
numeric quantities. Synthetic tests live in
`mock/data/product-get-numeric-fields.json`; no real account response is a fixture.

After regenerating contracts, Node BFF and formal MV3 completed all four
authorization configurations with nonempty data. Supported warehouse sources
returned one record; native IOP quantities returned two independently assessed
scopes. This sample explicitly had SPU zero and a positive SKU quantity: neither
was substituted for or summed into the other. The page and shared drawer passed
all twelve source display checks without script errors or profile changes.

The separately authorized IOP warehouse-delta experiment persisted and reread its
exact baseline before sending one plus-one request. The platform explicitly
rejected it with `ApiCallLimit`. No subtraction, write retry or cross-protocol
resubmission was sent. Fresh TOP and same-protocol IOP reads confirmed the original
quantity unchanged. This is a platform-blocked write acceptance, not a successful
modify/restore cycle. Native permission consent and the official inventory-page
cross-check were not established by the isolated-profile UI tests.

### Official-page cross-check (2026-11-02)

The retained remote Windows Chrome session found the exact candidate by product
ID in the official product list. Its editor displayed the same explicit variant
inventory quantity as the prior API readbacks. No field was edited and neither
Save nor Submit was used. The editor did not display a warehouse code or native
SKU identifier, so visual agreement is not independent evidence for those scopes.

The official list labeled the product RTS while the editor labeled it
Customization. Both observations are retained separately; no product-type switch
was attempted. A cropped screenshot and minimal read-only receipt remain in the
ignored acceptance directory. This cross-check does not change the platform
call-limit refusal or turn it into a successful modify/restore acceptance.
