# Product quality workflow

## Protocol preflight (2026-10-27)

| Sub-capability                      | TOP                                  | IOP                                                         | Parameters and boundaries                                                                                                                                       |
| ----------------------------------- | ------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product score                       | `alibaba.icbu.product.score.get`     | `/icbu/product/score/get` (verify registry before dispatch) | Workbench requests carry plaintext product IDs. TOP resolves the exact product's obfuscated ID; IOP uses plaintext. Read-only, application permission required. |
| Editor baseline                     | `alibaba.icbu.product.schema.render` | Existing registered Schema render path                      | Existing category, product ID, language and account context checks. No store scans.                                                                             |
| Save improvement                    | `alibaba.icbu.product.schema.update` | Existing registered Schema update path                      | Existing incremental patch, confirmation, persisted receipt and readback. No new write allowance.                                                               |
| Task verification                   | Existing product mutation job client | Same client, bound actual protocol                          | Accepted, auditing, verifying and verified remain distinct; unknown writes never resend.                                                                        |
| Quality report and field navigation | Not applicable                       | Not applicable                                              | In-memory UI only; never requires an extra authorization.                                                                                                       |

TOP score documentation: <https://developer.alibaba.com/docs/api.htm?apiId=47461>.
The public score response documents a numeric score and boutique tag, not an
exhaustive issue checklist. Missing problem details must never imply a clean
bill of health. Preserve platform messages verbatim and label local checks as
local suggestions. Field navigation is advisory and never edits content.

## Implementation and acceptance

- Freeze at most 30 selected current-page products for a read-only assessment.
- Serial reads and a shared five-minute account/protocol/language cache. There is
  no assessment-level automatic rescheduling or protocol fallback; the existing
  read-only transport retry policy is unchanged. Stop subsequent records on leave
  or account change.
- Preserve the assessment in memory while opening the existing editor. Explicit
  rechecks bypass stale caches; scores can lag behind platform review.
- Retain existing TOP-only, IOP-only, both default-protocol and legacy TOP tests.
- Real acceptance is read-only. This iteration does not publish, modify inventory,
  change authorizations, merge mainline, deploy Workers or submit the Store.

## Visible score queue recovery (2026-10-28)

- This optimization reuses the score protocol matrix above: TOP uses the exact
  product's obfuscated ID, IOP uses its canonical plaintext ID, and selection is
  still made before dispatch using the actual operation and payload. No new
  methods, permissions, mutations, fallback routing, or public contracts.
- The list and assessment freeze batch identity using the first checked read,
  avoiding the separate identity HTTP request for every single-item queue run.
  A fresh result uses four context reads plus one score request instead of six
  HTTP requests. Independent before/after checks run in parallel, but both must
  complete and match before dispatch/cache acceptance. Cached scores still
  require current account and actual read contexts; no context TTL is added.
- Visible rows drain serially with the existing 300 ms minimum interval. Each
  row is rechecked before dispatch, so newly hidden rows do not send score reads.
  Pausing clears transient loading states without aborting a dispatched read;
  valid in-flight results may still finish. Account/configuration changes discard
  late results, clear security-stop state, and require a new checked run.
- Failed rows do not automatically retry. The explicit retry icon requests only
  that row and respects the same authorization, cache, and account boundaries.
- Development acceptance is remote-only. Worker deployment and mainline release
  remain separate actions.

## User flow

1. Select 1–30 products on the current product-list page, then choose **More →
   Product assessment** (`更多 → 商品体检`). The selection is frozen for this run.
2. Choose **Start assessment**. Checks run serially and reuse matching cached
   reads. Stop pauses subsequent checks; it does not cancel an already sent read.
3. Choose **Review and improve** to open the existing editor. The assessment stays
   in memory. Platform messages and local suggestions are separate; only unique
   references to real Schema fields offer field navigation.
4. Existing save confirmation and mutation jobs are unchanged. After an accepted
   update, old scores are reference-only. **View save task** opens the exact job.
5. Use **Recheck score** after platform processing. It bypasses the score cache
   without submitting any product. Scores can lag behind a confirmed field update.
6. **Back to assessment** preserves this session's report. Refreshing or leaving
   the product workspace does not restore a report or resume any write.

## Verified evidence (2.20.0 baseline)

- Windows `pnpm check`: 373 test files / 3,773 tests passed, OpenAPI and i18n
  checks passed, Web/API/formal MV3 builds and store compliance passed. The
  unchanged extension limits remain in force (final MV3: 4,610,591 bytes unpacked).
- Focused browser tests: Chinese desktop and English/dark 390px viewport both
  passed the assessment → editor → explicit score recheck → report flow.
- Isolated real Node BFF: exact product lookup and score reads passed in TOP-only,
  IOP-only, dual/TOP-default and dual/IOP-default modes (8 checks).
- Formal MV3 runtime: the same 8 real read checks passed in four isolated profiles.
  No active credentials were replaced, no tokens renewed and no products modified.
- In both runtimes, TOP-only scoring used the exact-product lookup then the TOP
  score method; IOP-only and both dual configurations selected IOP before dispatch.
  No failures were retried through a different authorization.
- Private, sanitized receipts are under ignored `artifacts/product-quality-validation/`.
  The MV3 receipt does not claim native host-permission prompt acceptance.

- Full Web/formal-MV3 regression: 136 tests passed with no retries.
- Worker isolated replay: 26 tests across 10 files passed; no remote deployment.
- Existing remote Chrome profile: the new entry opened a frozen one-product
  assessment, fetched a real 3.9 score, rendered the live Schema, navigated from
  a local description suggestion to the real detail field, explicitly rechecked
  the score and returned to the retained report. Original TOP/IOP authorizations
  remained available and no unlock dialog appeared after reloading.
- The selected legacy detail was read-only because of unsupported HTML. Field
  navigation respected that boundary: no automatic conversion, edits or writes.
- A leftover editor status message on returning to the report was found during
  manual verification and cleared. Targeted checks and the formal extension
  rebuild passed after this presentation-only correction, followed by both
  focused Chinese/English browser flows passing again.

The real checks do not claim a newly executed product-update lifecycle. The
existing save/job/readback path is reused and covered by regression tests; this
iteration's real acceptance is deliberately read-only. Score changes are not a
prerequisite for a successful save and are not automatically polled.

This development branch is not a published release. Store upload, mainline merge
and Worker deployment remain separate actions.

## Queue recovery verification (2026-10-28)

- Remote Windows full pnpm check: 374 test files / 3,794 tests, formatting,
  lint, i18n, generated contracts, authorization modes, typecheck, Web/API/formal
  MV3 builds, bundle budgets and store compliance passed. MV3 unpacked size is
  4,618,719 bytes; existing limits are unchanged.
- Four focused browser cases passed: visible score cells, Chinese and
  English/dark assessment flows, and the formal MV3 column/score flow. The MV3
  case deliberately rejects the first read, proves it is not automatically
  retried, then succeeds through the explicit retry button.
- Twenty-four shared-list browser cases passed, including inventory, order
  roles, column preferences, search/filter/paging and score visibility.
- Isolated real Node BFF acceptance exercised the modified UI read queue in
  TOP-only, IOP-only, dual/TOP-default and dual/IOP-default modes. Each read two
  current products and returned scores 4.5 and 4.4. Four context requests per
  initial score were observed; a second run reused cached scores without
  additional score API calls. No loading state remained.
- The independent read-wire guard allowed only product-list and score methods;
  no business writes, Token refresh or active configuration changes occurred.
  Private receipts and logs are in the ignored artifacts/score-recovery-* paths.
- Real acceptance above covers Node BFF. Formal MV3 browser acceptance uses
  isolated replay, not a newly installed extension's real domain permissions.
  No mainline merge, production deployment or Store publication is included.
