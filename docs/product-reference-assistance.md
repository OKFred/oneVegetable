# Product reference and listing assistance

Five native IOP read-only APIs. No mutation, Token refresh, default authorization
change or replacement of the existing Schema editing/task readback workflow.

| Capability          | TOP boundary                           | IOP public path                               | Parameters / initial evidence                                |
| ------------------- | -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| Predict category    | Not adapted                            | /alibaba/icbu/category/predict/v2             | Required title; optional description/image; account accepted |
| Browse categories   | Existing category.get.new unchanged    | /alibaba/icbu/category/get/v2                 | Optional parent ID; root accepted                            |
| Category attributes | Existing Schema editing unchanged      | /alibaba/icbu/category/attribute/get/v2       | Confirmed leaf ID; call accepted                             |
| Product reference   | List/render remain distinct DTOs       | /alibaba/icbu/product/get/v2                  | Exact product or SKU ID; call accepted                       |
| Shipping templates  | Existing logistics templates unchanged | /alibaba/icbu/product/list/shipping/templates | Read names and IDs; 101 entries accepted                     |

All five need IOP and application permission. Documentation, adaptation, current
account permission, successful response and official-page comparison are separate.
Dual authorization chooses the actual method before dispatch, not the default
or an unrelated photo context. TOP-only receives a clear request to configure IOP.

The separate status/get/v2 returned Product not found for the same existing test
product accepted by get/v2 and shown Active on the official list. It is excluded.
Online state and audit state remain separate. Photo scope guards stay intact.

Requests use NetworkManager, requestId, one attempt, >=350 ms spacing and bounded
reads. No store scanning, failure-to-Mock fallback or failed cross-protocol retry.
Unsafe numeric IDs are rejected; money stays exact text; missing values are unknown.
HTML is untrusted. Applying a suggested category needs the existing unsaved guard.

Remote Node and formal MV3 acceptance compare the same product against the
official page. Raw account data and credentials stay ignored. All protocol modes,
permission/expiry failures, cache identity and late responses require regression.
Runtime acceptance and official-page comparisons are recorded below.

## Explicit response differences

The first typed account call exposed a documented String versus actual JSON
number at product_info.trade_info.price.tiered_price[].price. The contract accepts
only these two scalar representations at that field, preserving the received value
as display text. No numeric price calculation or fabricated currency is introduced.
Successful native responses also omit optional message/msg_code; positive success
and the method-specific payload are still required. Initial failed receipts remain.

## Remote read acceptance, 2026-10-26

- Authenticated Node BFF: five of five methods accepted with contract validation.
- Formal MV3 build in an isolated encrypted profile: five of five accepted;
  five provider requests, zero blocked requests, zero mutations and no TOP fallback.
  The source build digest stayed unchanged. This tests the shipped runtime, not
  native host-permission consent or the credential-import UI.
- Exact product ID and category-to-attribute ID checks passed on both runtimes.
  Category prediction returned a different leaf from the existing product:
  this is a suggestion disagreement, not evidence that either category is correct.
  It remains explicit, manual and subject to the existing unsaved-edit guard.
- Official Alibaba edit/list pages showed the matching category path, Glass
  material, MOQ 1, Piece unit, USD 1 quantity tier, Active status and an unselected
  shipping template. Missing API inventory remains unknown, not zero.
- Shipping-template API returned 101 entries. Its full list was not compared
  entry by entry with the official page; no store-wide scan was performed.
- Earlier prediction calls returned explicit ServiceTimeout / RPC timeout.
  Those failed receipts are retained. A separately confirmed descriptive title
  succeeded; no automatic retry or hidden title replacement was added.

Redacted receipts stay under ignored artifacts/product-reference-validation/.
No account credentials, raw responses, authorization refresh or provider writes
are part of this feature. Automated suites use checked-in synthetic samples only.
