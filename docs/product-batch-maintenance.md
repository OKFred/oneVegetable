# Existing-product batch maintenance (2.14.0 development)

## Scope and use

Select up to 30 existing formal products on the current product-list page, then choose **More → Batch maintenance**. The lazy-loaded workspace freezes that selection. Configure a destination group, keyword append/remove/replace, or both; each keyword is a separate input, never split on commas. Preview every product, deselect individual items, and confirm the actual write count.

The group selector supplies its parent/child path. Keywords preserve existing spelling, order and duplicates unless the explicit rule changes them. New inputs are trimmed and deduplicated case-insensitively. Fixed keyword slots are never invented or silently truncated. A missing, read-only or unrepresentable target blocks the whole product, not just one selected rule. Platform content restrictions appear as warnings; structural safety remains mandatory.

Only changed group/keyword roots enter the incremental Schema update. Title, description, images, price, inventory and display state are not submitted. No Alibaba method or mutation allowlist was added.

## Safety and persistence

- Requests are serial, at least 300 ms apart, with no automatic retries. Before each write, re-read exact product status/category and the selected roots' structure, rules and values; unrelated field changes do not conflict. This is a preflight check, **not an Alibaba atomic version lock**.
- The browser obtains an exclusive Web Lock; unavailable locks prevent execution. The backend/service worker additionally rejects products with blocking durable receipts. A browser lock is not the only duplicate-write guard.
- Every batch uses an opaque identity/Alibaba-configuration context. No S3 dependency. Normal provider-managed Token refresh keeps its configuration generation; account or imported-configuration replacement invalidates old contexts. The validated credential snapshot is the one used for dispatch.
- Persist each product receipt, batch ID and context **before** sending. Storage failure means no outgoing write. SQLite and D1 use migration `0015_product_batch_context.sql`; old receipts retain null context/batch rather than inferring ownership.
- Explicit business rejection is failed; timeout, connection loss or unexplainable provider response is unresolved. An unresolved write stops subsequent products and must not be resent. A successful HTTP response or accepted update is not a completed modification.
- Accepted writes are checked through existing field fingerprints, at least five seconds apart for at most five minutes while the workspace remains active. Audit/review or delayed platform readback remains pending. The task center can query again without sending another update.
- Leaving, closing, stopping or page unloading stops later scheduling, not an already-sent write. Accepted receipts survive interruption, including a stop between context verification and readback dispatch. Refresh never restores editor rules or restarts writes. Unsent products require a fresh selection, preview and confirmation.
- Only receipt metadata/fingerprints are durable; full XML and unsubmitted rules stay in memory. Task-center batch counts describe the loaded receipts, not unseen pages or products never sent.

The new internal endpoint is `POST /product-mutation-jobs/context/get` under the configured API prefix. Operation envelopes accept optional `productContext` and `productBatchId`; batches require both and only permit `updateProduct`. Existing clients remain compatible. Administrator, CSRF, trusted-extension sender and per-operation checks still apply.

## Validation commands

All commands run in Windows from the repository root:

```powershell
pnpm check
pnpm test:worker
pnpm exec playwright test --workers=1
pnpm test:e2e:bff-replay
pnpm test:e2e:node-credentials
```

Fixtures live under `mock/data`. Web E2E uses a dedicated in-memory maintenance gateway; it is never used by production gateways. Formal MV3 E2E intercepts the gateway and blocks other HTTP traffic, proving context rejection, durable accepted/unknown receipts and duplicate prevention without real product changes. D1 tests verify nullable legacy metadata and concurrent duplicate rejection.

Validator prefix compaction reuses generated JSON-pointer prefixes without changing contracts; parity tests compare all generated validators, complete errors and evaluation state. Package budgets remain ZIP 1,500,000 bytes, unpacked 4,100,000 bytes and the existing per-chunk limits. This development branch does not publish a version or overwrite the previously released 2.13.0 artifact.

### Local regression evidence (2026-09-30)

- Formatting, ESLint (zero errors; existing warnings retained), bilingual catalog checks, OpenAPI drift, offline API audit, replay coverage and workspace type checks passed.
- Full unit regression: 275 files / 1,837 tests passed. One existing lazy Logs-panel test initially timed out under parallel load; it now explicitly awaits the dynamic import rather than increasing its timeout, and the full suite passed again.
- Worker/D1: 7 files / 22 tests passed. Web/formal-MV3 E2E: 99 passed. Worker BFF replay and Node credential E2E: 2 each passed. Both new batch scenarios also passed against the final rebuilt extension.
- Web, Worker dry-run and formal MV3 builds, bundle gates and Store compliance passed. Final unpacked size: 4,063,624 bytes / 189 files. Reproducible ZIP size: 1,160,168 bytes, measured in memory with the existing package settings; no released ZIP was overwritten.
- These are automated/isolation checks, not the pending Alibaba live acceptance below.

## Real-account acceptance: blocked, not passed

`pnpm smoke:product:batch-maintenance:real` runs `scripts/smoke-product-batch-maintenance-real.ts` in read-only mode by default. It uses an isolated local Hono/SQLite instance and the existing ignored credential bundle. Enabling writes additionally requires explicit `ONE_VEGETABLE_BATCH_SMOKE_WRITE=1` and `ONE_VEGETABLE_BATCH_SMOKE_PRODUCT_ID`; this is not permission to bypass an unresolved earlier test. The script saves a minimal original group/keyword baseline before submission, validates temporary values before any restoration, and refuses further write smoke runs while an earlier run is unresolved.

On 2026-09-30 (local time), one Node BFF test update was accepted. Subsequent readback returned `PUB_BIZCHECK_PRODUCT_IN_AUDITING`. Testing stopped with the durable receipt and restoration baseline preserved under the ignored `artifacts/product-batch-maintenance/2026-09-29T19-16-59-415Z/` directory. **No restoration has been sent or verified; the temporary group/keyword change must be treated as potentially applied.** No further product or MV3 real write was attempted. Do not treat offline tests as real-platform acceptance.

Next authorized step is a read-only check of that exact product and receipt. Do not replay the write script, blindly compensate during review, alter unrelated fields or start the second real sample. After platform review clears, restoration requires checking the exact temporary values and re-confirming the recovery action. The ignored `HANDOFF.md` contains the product/request/job IDs; those account-specific values are not copied into public docs.

Remaining real acceptance: verify and restore the first sample, then independently validate the formal MV3 sample. Worker remains isolated replay only; no production deployment, mainline merge or Store submission is included.
