# Absolute inventory quantity evidence (diagnostic only)

`assessAbsoluteInventoryEvidence(target, row)` consumes diagnostic metadata only.
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
