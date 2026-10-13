# Existing-product batch maintenance (2.14.0 candidate)

Historical baseline: the original sections below preserve the September 30–October 1 preparation and blocked-acceptance evidence, including the budgets used then. They are not the current acceptance status. See the **2026-10-13 closure and current budgets** addendum for the 2.15.0 update; no historical report or released artifact is overwritten.

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

Validator prefix compaction reuses generated JSON-pointer prefixes without changing contracts; parity tests compare all generated validators, complete errors and evaluation state. Package budgets remain ZIP 1,500,000 bytes, unpacked 4,100,000 bytes and the existing per-chunk limits. Candidate preparation uses version 2.14.0 without overwriting the released 2.13.0 artifact; a version bump is not a formal release or Store submission.

### Local regression evidence (2026-09-30)

- Formatting, ESLint (zero errors; existing warnings retained), bilingual catalog checks, OpenAPI drift, offline API audit, replay coverage and workspace type checks passed.
- Full unit regression: 275 files / 1,837 tests passed. One existing lazy Logs-panel test initially timed out under parallel load; it now explicitly awaits the dynamic import rather than increasing its timeout, and the full suite passed again.
- Worker/D1: 7 files / 22 tests passed. Web/formal-MV3 E2E: 99 passed. Worker BFF replay and Node credential E2E: 2 each passed. Both new batch scenarios also passed against the final rebuilt extension.
- Web, Worker dry-run and formal MV3 builds, bundle gates and Store compliance passed. Final unpacked size: 4,063,624 bytes / 189 files. Reproducible ZIP size: 1,160,168 bytes, measured in memory with the existing package settings; no released ZIP was overwritten.
- These are automated/isolation checks, not the pending Alibaba live acceptance below.

## Historical real-account acceptance (2026-09-30–10-01): blocked, not passed

`pnpm smoke:product:batch-maintenance:real` runs `scripts/smoke-product-batch-maintenance-real.ts` in read-only mode by default. It uses an isolated local Hono/SQLite instance and the existing ignored credential bundle. Enabling writes additionally requires explicit `ONE_VEGETABLE_BATCH_SMOKE_WRITE=1` and `ONE_VEGETABLE_BATCH_SMOKE_PRODUCT_ID`; this is not permission to bypass an unresolved earlier test. The script saves a minimal original group/keyword baseline before submission, validates temporary values before any restoration, and refuses further write smoke runs while an earlier run is unresolved.

On 2026-09-30 (local time), one Node BFF test update was accepted. Subsequent readback returned `PUB_BIZCHECK_PRODUCT_IN_AUDITING`. Testing stopped with the durable receipt and restoration baseline preserved under the ignored `artifacts/product-batch-maintenance/2026-09-29T19-16-59-415Z/` directory. **No restoration has been sent or verified; the temporary group/keyword change must be treated as potentially applied.** No further product or MV3 real write was attempted. Do not treat offline tests as real-platform acceptance.

Read-only checks on September 30 and October 1 confirmed that the changed group and keywords match the temporary values, while the platform reports `tbd` (review rejected). The receipt's `verified` status confirms only the field fingerprints, **not platform approval or restored values**. The original baseline still does not match. No further Alibaba writes were sent.

Next step is to inspect the platform review reason and establish a separately confirmed restoration route. Do not replay the write script, bypass the formal-product status guard, blindly compensate, alter unrelated fields or start the second real sample. The ignored `HANDOFF.md` contains the product/request/job IDs; those account-specific values are not copied into public docs.

Remaining real acceptance: verify and restore the first sample, then independently validate the formal MV3 sample. Worker remains isolated replay only; no production deployment, mainline merge or Store submission is included.

## 2026-10-13 closure and current budgets

The historical Node sample is now closed: its original batch change and separately authorized restoration were readback-confirmed, the original group/keyword baseline matched exactly, and the product returned to approved/online with unchanged category. Its independent recovery receipt was verified in its own actor/context; the earlier failed report and receipt history remain preserved.

The formal MV3 live change/restoration workflow is also closed. The current redacted report records `stage=restored-and-confirmed`, `restored=true` and `untouchedFieldsMatched=true`; the independent group-clear task is `verified`, and `oldReceiptRebound=false`. The original semantic group/keyword baseline and all non-target values match. The production Manifest and the user's active TOP configuration were unchanged.

That MV3 workflow made three distinct writes, each once: the original group/keyword change; the first restoration, which restored keywords but left the group unchanged because its value-less group representation was ignored; and an explicitly confirmed group-only correction with an empty `first_group_id` value. Exact readback identified the intermediate result as a known partial restoration, not an unknown outcome. The correction required the known-partial guard to match original keywords, the temporary group and the whole planned-original-values fingerprint. It was not an automatic resend, guessed identifier or change to other fields. Failed/pending reports remain archived; the final recovery has an independent context and receipt rather than rebinding an old task.

Empty-node comparison compatibility is limited to three declared `productGroup` input paths. Each accepts omission, a value-less node or an empty value, yielding at most 27 representations. Original expected values/hashes remain intact; non-empty identifiers, attributed values and unknown roots remain strict. This comparison rule does not treat a real temporary group as an empty original group.

The operator correction used for acceptance does **not** add a user-facing bulk group-clear or automatic-rollback entry point. Batch maintenance remains difference preview, explicit confirmation, serial incremental updates and durable readback. An accepted request must still wait for platform review and field verification; unresolved requests are not automatically resent.

Current authorized repository budgets are ZIP **2,000,000 bytes** and unpacked **5,470,000 bytes**, implemented by `2618d1c`. These decimal-byte budgets are not Store platform limits; all existing per-chunk, permission and security gates remain unchanged. The older 1,500,000 / 4,100,000-byte figures above are historical. The released 2.13.0 ZIP retains SHA-256 `2292ad492b9a4f2c843e254c1384c7c6a4e1e26e79a70fd61fcf9125b91273c7`.

The public-source final `pnpm check` exited 0 with actual **300 files / 2,233 tests passed**, plus format, lint (zero errors / 30 existing warnings), i18n, OpenAPI/generated drift, workspace types, Web/AuthPages/Worker dry-run/MV3 builds and Store compliance. Log: `artifacts/release-2.15-check-public-final.log`. Workspace typecheck success does not mean the separate root-script scan is clean: 33 existing type debts remain.

The latest Worker **23** tests, Node credential **2** tests and BFF replay **2** tests passed. Logs are `artifacts/release-2.15-worker-last.log`, `artifacts/release-2.15-node-credentials-rerun.log` and `artifacts/release-2.15-bff-replay-rerun.log`. The final authorization **9/9** passed in **38.5 seconds** on the same FROZEN build as focused batch and full E2E.

Final same-build acceptance is recorded in `artifacts/release-2.15-e2e-fingerprint-final-frozen-20261013-185824/verification.json`: `allPassedSameBuild=true`, with focused batch **1/1**, complete Web/formal-MV3 **105/105** in **5.7 minutes**, and authorization **9/9** in **38.5 seconds**. All used the same **205-file / 4,102,165-byte** build. Directory aggregate hash: `ABF27AAEBA710CB6B59DC4BDB47171EA98C51427A1CA636F58E934032DFA2309`. The three logs are in that FROZEN folder.

The pre-freeze 185025 105/105 pass is explicitly excluded from final same-build acceptance. Earlier stable dev Vite and 104/105 startup-timeout runs remain historical snapshots. The timeout did not recur after freezing and timeouts were not changed; old results are not rewritten as static-production full acceptance.

Final packaging passed: ZIP **1,190,841 bytes / 205 entries**, unpacked **4,102,165 bytes**, below the **2,000,000 / 5,470,000-byte** budgets. ZIP SHA-256: `f848acc45e21de71a7838e10033baeb5c71224ec5e8815054bf32e23bb332058`. Known-secret source-delta and all 205 ZIP-entry checks covered **10 sensitive values**, with **0 matches / 0 unsafe packaged paths**; values are not copied here, and this is not an unrestricted history/unknown-secret audit. The original 2.13.0 ZIP hash is unchanged.

**2.15.0 candidate preparation is complete: all release gates passed.** This is not a formal Store publication, merge, tag or deployment. This follow-up edits only the two authorized Markdown documents; public/generated sources, code and artifacts stay frozen, with no generation, commit or push.
