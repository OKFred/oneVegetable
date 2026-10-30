# Product API workbench

Base: origin/staging 3d4dd526 (2.20.2). Branch codex/product-api-workbench.
All source, builds and live checks stay on remote Windows; authorizations and defaults preserved.

## Protocol preflight (2026-10-30 public documents)

| Feature               | TOP                                                      | IOP                             | Boundary                                             |
| --------------------- | -------------------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| Model/SKU code search | Existing title/ID search unchanged                       | /alibaba/icbu/product/search/v2 | Read, exactly one criterion, max20                   |
| Price                 | Existing Schema editor unchanged                         | /icbu/product/edit-price        | SPU range/tiers OR explicit SKU prices               |
| Inventory             | Existing +/- capability remains distinct                 | /icbu/product/edit-inventory    | Absolute nonnegative SPU OR SKU quantity             |
| Draft cleanup         | No confirmed public equivalent                           | /alibaba/icbu/draft/delete      | Exact recorded draft identity, never formal products |
| Translation           | text.trans / text.recognize / text.recognize.trans       | No mapping                      | App grant required even without user session         |
| Freight coverage      | country.getcountrylist + logistics.country.getcoststatus | No equivalent assumed           | Determinacy, not freight quotation                   |

TOP docs:67157/67167/67168/58733/58734. IOP public getApi.json cid11.
Documented, adapted, permission, accepted, verified and restored are separate statuses.
Never infer TOP equivalence, fall back to Mock or retry a failed request via another protocol.

## Delivery batches

1. Public native search contracts, routing, lookup dialog and auth-mode tests.
2. Price intent/confirmation/readback and explicit restoration.
3. Absolute inventory workflow; delayed-effect notice, exact readback and restoration.
4. Draft identity review, one-shot deletion and per-ID receipt.
5. Translation preview/copy; no automatic overwrite or publication.
6. Country freight-determinacy tool and explicit returned-template selection.

Each completed batch is tested then committed. Push development branch after gates.
Do not merge mainline, deploy Worker or upload Store package in this task.

## Safety gates

Administrator, CSRF/trusted extension, per-method flags and explicit confirmation remain.
Persist identity/protocol/intent before sending. Storage failure means no outgoing request.
One request per durable intent; unknown results stop and cannot be resent.
Preflight current values; conflict requires another preview. No automatic compensation.
SQLite/D1 and extension repositories must share cross-window exclusion and receipt semantics.
No global Worker in-memory lock, full XML persistence, secret logging or widened generic writes.
TOP-only, IOP-only, dual/TOP-default, dual/IOP-default and legacy unmarked TOP regressions required.

## Authorized remote acceptance

User approved only new unbranded test data: small price change/restoration, inventory
change/restoration, newly created test draft deletion after exact ID matching.
No daily products, payments or blanket deletion. Use ignored artifacts/product-api-workbench.
Permission/prerequisite failures are recorded, never counted as passed.

## Current delivery and acceptance boundaries

- Product list More opens model/SKU-code lookup, translation, country freight determinacy and
  account-scoped draft receipts. Row actions contain the independent price and absolute-inventory
  workspaces. These are lazy views, not automatic business writes.
- Lookup is IOP-only. Translation and freight determinacy use TOP, independently of the selected
  default authorization. Failed requests never retry through the other protocol.
- Live lookup returned the new controlled sample. Numeric tier prices and lead times observed in
  the response are supported explicitly; unrelated fields remain strict.
- The TOP country list returned 281 grouped records, not necessarily 281 unique countries.
  Translation was rejected by the test application's permission package. Neither result implies
  every merchant has the same entitlement.
- Freight template reading and determinacy passed with a returned TOP template and an explicitly
  hypothetical 1 kg, 10 x 10 x 10 cm package. The response contained 246 country records, not a
  monetary quote or a logistics order. The template operation returns its first page (up to 100),
  not a claimed scan of every template.
- Price amount change, readback, restoration and final amount readback passed in the opt-in Node
  CLI. Non-target model information was later missing; a separate unmodified control retained its
  model after approval. This observation is not universal causation proof, and full price integrity
  acceptance has **not** passed. The standalone price endpoint remains disabled.
- Absolute inventory has no usable readback baseline on these samples. Draft deletion has no
  reliable independent absence reader. Both remain disabled; no stock change or draft deletion
  was attempted.
- Node/Worker/MV3 runtime acceptance whitelists stay empty. Offline HTTP, MV3 and workerd tests
  must not be described as provider write acceptance or a production deployment.

Only the two new unbranded test products were created. The first had two bounded price writes
and its original amount was restored; the second is a no-price/no-inventory-write control.
Existing goods, inventory, authorization profiles and defaults were not changed. Keep private
receipts, baselines and one-shot claims under ignored artifacts; do not upload them as fixtures.

## Follow-up: field integrity and readback (2026-10-30)

- The original price intent fingerprint matches its saved dispatch. Its only business parameters
  were `product_id` and `price` (currency, price type and tiers). No empty model, Schema or full
  product object was sent. The native endpoint has no documented model-preservation parameter;
  the observed collateral-field risk remains unresolved and no runtime write gate was opened.
- A single, explicit incremental Schema update restored only the new test product's model number.
  The first bounded readback ended while the platform was reviewing it; that original receipt is
  preserved. Later get/v2 and the official product list confirmed the original model and USD 1.00.
  No repeat restoration was sent. Independent read-only comparison of 24 protected hashes matched.
- Both the restored product and the untouched control expose their model in get/v2, while Schema
  render leaves the model field empty. Empty rendered Schema is therefore not an independent proof
  of model deletion for these samples. Do not silently fill or overwrite platform fields from it.
- New maintenance previews persist target values plus non-target hashes, not full product content.
  The send preflight checks both. Price/inventory readback cannot become verified when model,
  title, pictures, identifiers or other protected data differs or cannot be checked. Historical
  target-only tasks remain readable, but cannot acquire missing integrity evidence retroactively.
  A pending/unknown review cannot become verified from an early matching amount; dispatch requires
  a confirmed product state and readback waits for approval, without replaying a write.
- The price-only acceptance CLI has the same guard and stops after a collateral-field mismatch;
  it does not automatically compensate or resend. UI previews hide integrity hashes and show a
  localized next action when non-target fields differ or evidence is unavailable.
- Inventory diagnostic used six one-shot public reads across the two new products. Both were
  approved: get/v2 omitted inventory, the inventory API explicitly returned an empty list, and
  Schema provided neither a quantity nor a warehouse code. This is not stock zero and supplies no
  restorable inventory baseline. Absolute inventory writes remain disabled.
- Native IOP status/get/v2 is now typed as a read capability. Successful status=draft can establish
  scoped presence from a trusted draft receipt; all other statuses/errors remain unknown. There
  is still no documented independent absence result, so draft deletion remains disabled. No
  matching verified draft receipt was available for live presence acceptance; no draft was created
  or deleted merely to manufacture an acceptance result. A separate read-only status request on the
  new formal sample returned an HTTP 200 ISP error envelope, not a documented success result.
  This is recorded as an upstream failure, never draft presence, absence or a permission pass.

All follow-up business operations used the isolated IOP profile. TOP/defaults, existing products,
stock, S3 configuration and production deployments were not changed.
