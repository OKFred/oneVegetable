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
