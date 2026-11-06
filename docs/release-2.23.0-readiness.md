# 2.23.0 candidate readiness

## Scope

Add five native IOP fulfillment reads and a separate guarded attachment upload
from local files or private S3. Ordinary S3 files and platform attachments are
limited to 5,000,000 bytes; specialized ZIP and video limits stay unchanged.
See [protocol preflight and account evidence](order-fulfillment-s3-attachments.md).

No order placement, payment, shipment, product or inventory mutation is included.
Attachment acceptance is not content readback or association with an order.
Upload receipts must be persisted before dispatch; unknown outcomes are not resent.
Node/Worker attachment storage needs migration 0019 and explicit method enablement.
No production migration or deployment is performed during candidate preparation.

## Remote regression

The replay gateway previously sent five native IOP methods to a TOP endpoint.
An explicit read-only set now routes them to the synthetic IOP transport.
All 62 documented replay examples pass, with dedicated Node and workerd tests
covering protocol/context isolation, no real fetch and attachment-write rejection.

Fresh isolated Node BFF and formal-MV3 reads on 2026-11-06 preserved authorization
slots and defaults in TOP-only, IOP-only, dual TOP-default and dual IOP-default modes.
Each mode tested 17 probes, with an independent read-only wire guard and no
blocked or duplicate outbound requests. TOP and both dual modes had 13 nonempty
successes, 3 valid empty results and 1 RFQ permission refusal.

IOP-only had 10 successes, 1 empty result, 4 explicit unsupported operations,
1 photo-scope protection and 1 existing video business rejection
(`ALIBABA_IOP_BUSINESS_REJECTED`, illegal param error).
That full live matrix exits nonzero because the video sample failed; it is not
reported as entirely passed in either runtime. The disposable MV3 copy pregrants
the exact IOP host; this is not native permission-consent acceptance.
Photo-group scope and video platform failures match
the documented pre-existing limits. No failed request fell back to TOP or Mock.
Private evidence is under `artifacts/order-fulfillment-acceptance/`, never in CI uploads.

## Candidate gates

Run formatting, lint, i18n, generated-contract drift, types, complete unit tests,
workerd replay, Web/BFF and formal-MV3 tests before packaging the exact source.
Keep the existing 2,000,000-byte ZIP and 7,000,000-byte unpacked limits and all
per-chunk/security gates. Do not rebuild a loaded extension output during tests.

Candidate preparation does not submit the Chrome store, deploy the website,
create an immutable Tag or publish a GitHub Release. Report those separately.
