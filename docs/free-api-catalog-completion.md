# Free API catalog completion and account acceptance

## Stable generator input

`docs/alibaba-free-api-docs.json` has this versioned shape:

```ts
interface Snapshot {
  schemaVersion: 1;
  checkedAt: string; // YYYY-MM-DD: public documentation check, NEVER account verification
  source: 'publicdoc';
  capturedAtUtc: string; // original anonymous capture, retained by offline regeneration
  catalogCount: 35;
  definitions: Definition[];
}
interface Definition {
  method: string;
  docId: number;
  docUrl: string;
  title: string;
  description: string;
  domain: string;
  risk: 'read' | 'mutation';
  featureArea: string;
  businessScope: 'general' | 'conditional';
  permissionGroups: string[];
  auth: 'required' | 'optional' | 'none' | 'unknown';
  chargeLabel: string;
  restricted: boolean;
  restrictionReason: string | null;
  checkedAt: string; // same date as snapshot
  updatedAt: string | null; // YYYY-MM-DD from official gmtModified
  requestParams: ParamNode[];
  responseParams: ParamNode[];
  errorCodes: unknown[];
  requestExample: string | null;
  responseExample: string | null;
  rawDocument: Record<string, unknown>; // allowlisted public source fields, not a session dump
}
interface ParamNode {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  demoValue?: string;
  minValue?: number;
  maxValue?: number;
  maxLength?: number;
  maxListSize?: number;
  subParams: ParamNode[]; // complete recursive source structure, including empty leaves
}
```

Examples are official document text, not real account responses or guaranteed valid JSON.
`responseExample` prefers `rspSampleSimplifyJson`, then `rspSampleJson`; malformed official
examples remain strings. `requestExample` is null when the document has no request sample.
Consumers may build examples from `demoValue`, but must not call these account-verified.
`rawDocument` retains the selected original fields, including nested request/response
parameters, sample strings and errors, for deterministic offline rebuilding. It excludes
SDK snippets, environment settings, cookies, account envelopes and anonymous session tokens.

## Scope and authorization boundary

The config pins exactly 35 docId/method identities: 8 general and 27 conditional.
Free price, user authorization, business qualifications and account acceptance are independent.
All conditional entries remain `restricted: true` with their permission-group qualification.
That flag describes the business qualification, not a ban on a separately authorized local
smoke test. Such tests must still pass actual platform authentication and API grants;
no bypass, placeholder success or automatic account verification is permitted. The audit and
snapshot commands themselves never execute account/business requests.

The general/conditional grouping is explicitly approved scope, not inferred from method names.
Risk/domain/featureArea are explicit config metadata. In particular token creation, payment,
upload, push, notification, saving and writeback are mutations.
Excluded vendor-specific families (Xiaoman/Snsoft) do not mean all `seller.vendor` APIs: the
explicit service-market docIds in this scope are included. Anything outside the pinned set,
identity mismatch, fee/unknown price or Jushita-only change fails closed.

## Commands (Windows, repository root)

```powershell
# Normal anonymous TOP session; public documentation only, never account cookies.
pnpm exec tsx scripts/audit-top-api.ts --seed-doc-id=48967 --output=artifacts/free-api-audit --scope=config/alibaba-free-api-scope.json

# Repeat audit from captured files, without network.
pnpm exec tsx scripts/audit-top-api.ts --seed-doc-id=48967 --output=artifacts/free-api-audit --scope=config/alibaba-free-api-scope.json --offline

# Fresh anonymous capture then snapshot (same scoped audit).
pnpm exec tsx scripts/snapshot-free-api-docs.ts

# Rebuild from a specific audit, retaining its original capture date.
pnpm exec tsx scripts/snapshot-free-api-docs.ts --offline --input=artifacts/free-api-audit

# Clean-checkout, network-free regeneration from checked-in rawDocument fields.
pnpm exec tsx scripts/snapshot-free-api-docs.ts --offline

# Deterministic drift check: no file writes or network.
pnpm exec tsx scripts/snapshot-free-api-docs.ts --offline --check
```

Audit without `--scope` retains the legacy related-catalog inventory behavior. An explicit
scope checks and captures only its pinned methods. Neither offline command advances checkedAt.
The snapshot is written only after all 35 sources pass validation; partial capture is not success.

## Implemented runtime surface

- All 35 methods have request/response JSON Schemas, generated TypeScript maps, examples in
  `mock/data/free-api`, and CSP-compatible standalone validators. The audited catalog now has 134 entries.
- The six unrestricted new reads are enabled in the generic debugger. Conditional methods remain
  inspectable (contracts, examples, permission group and business scope), with an accurate disabled reason.
- BFF and MV3 use the same target-method policy. A generic `callCapability` envelope cannot turn a
  mutation into a read, override signed transport parameters, or bypass qualification restrictions.
  Generic writes stay closed; existing dedicated write workflows are unchanged.
- Methods documented as not requiring user authorization omit `session`, but still require AppKey,
  signing and applicable application permission. Nested business fields such as translation `format`
  are preserved. Token-like response fields are redacted, including tokens embedded in JSON strings.
- `contractValid` means shape validity, not platform business success. Raw nested success/error
  indicators remain visible; unknown shapes return contract warnings rather than a fabricated success.
- TOP requests use `simplify=true`; DTO wrapper names are not guessed from Java class names. Response
  differences require explicit overrides. Scalar order IDs support lossless decimal strings; unsafe
  JavaScript numbers, exponent strings and negative IDs are rejected before dispatch.
- Identical validator roots and registry metadata are shared at build time. Tests compare the complete
  generated catalogs against OpenAPI/audit data and preserve AJV error behavior. No runtime `eval`,
  new dependency, host permission or package-budget increase is introduced.

## Real test-account observations (2026-09-22)

The user authorized testing against this account, including writes. This is not presented as an
official Alibaba sandbox. Missing business identifiers are not replaced with example IDs.

The initial local report covers all 35 entries: **1 passed, 7 permission-denied, 26 missing prerequisites,
1 result-unknown**. This is not full live acceptance.

- `product.id.encrypt`: successful real-product request and valid response; marked account-verified.
- Platform permission denial: industry topics, trade-assurance account, distribution product list,
  service-market order list, dropshipping token creation, order logistics tracking and payment-result
  query. Account-specific denials stay in local evidence, not as universal API restrictions.
- Inventory update: one `plus 1` was dispatched and explicitly acknowledged. Immediate readback did
  not match the expected delta. Delayed SKU/product inventory reads agreed with each other, but the
  first runner failed to persist the original quantity. We cannot prove restoration. No `sub` or
  repeated `plus` was sent; the method remains closed and further smoke writes are held.
- The runner now persists the baseline, target SKU/warehouse, every readback, UUID request IDs and
  write intent before dispatch. Existing unresolved receipts block subsequent write runs. Never infer
  a missing historical baseline from current stock or erase a receipt just to retry.
- Video upload is not accepted: the currently configured local S3 endpoint is private HTTP without
  a public media base URL, and no verified owned test-video object was found. No video was uploaded,
  no bucket was made public, and no external service was provisioned.
- Other skipped entries require actual translation service registration, distribution product IDs,
  authorized shop-clone identity, live room, vendor service/order, coupon or logistics batch data.
  No order creation, payment, delivery, invented customer identity or business notification was sent.

Raw account data and receipts remain in ignored `artifacts/free-api-validation/`. The inventory
reconciliation file records the exact affected target for manual review; it contains no credentials.
Older initial receipts lacked persisted request IDs/baselines: later instrumentation does not
retroactively make those records complete. The current unresolved inventory receipt must be reviewed
before another write acceptance run; this iteration does not open either new write method by default.

### Authorized fresh-baseline follow-up (2026-09-22)

The user explicitly authorized a new test using freshly recorded current stock. The initial
historical receipt remains unresolved; the new test does not infer or restore the missing old baseline.
Two public inventory queries agreed on the complete SKU/warehouse snapshot before dispatch.
Exactly one `plus 1` and one `sub 1` were sent. Both acknowledged success; eventual dual-query
readbacks confirmed the increment and then the complete original **new-test** snapshot.

The immediate reads were stale: the first 4 readback rounds did not yet show the increment.
A later read did, permitting a separately guarded subtraction. The new runner now allows up to
16 read-only observations, 10 seconds apart. No mutation retry occurs. Unexpected changes,
ambiguous acknowledgements or persistence failure still stop the run.

`scripts/smoke-inventory-rebaseline-real.ts` requires the exact previous receipt and its original
account/product/SKU/warehouse fingerprint. A prior receipt permits only one new experiment;
the immutable intent blocks repeating it. `--restore-delayed` resumes only subtraction against
a durable acknowledged increment whose complete expected snapshot is visible. An exclusive
subtraction intent prevents replay. Every call has a persisted UUID and minimal request parameters.

The follow-up validates inventory update for this test account, bringing latest per-method outcomes
to **2 passed, 7 permission-denied, 26 missing prerequisites**, with **one historical inventory event
still unresolvable**. The local consolidated follow-up records exact targets, timings and receipts.
This does not open production/debugger writes or assert a fixed platform synchronization delay.

### Operator guidance

Web and MV3 display the same bilingual readback notice in the inventory drawer and inventory API
definitions, plus pending product jobs, batch publishing, gallery transfers and video associations.
Acknowledged requests explain that processing/synchronization can take time; unconfirmed outcomes
remain explicitly uncertain and direct users to check results before any new submission. Completed
jobs no longer show a pending notice, and actual errors remain visible. No fixed delay is promised,
no failed response is relabelled as success, and this copy-only change opens no write capability.

## Controlled smoke commands

```powershell
# No network; validate local credential availability and enumerate prerequisites.
pnpm smoke:free-api:real --preflight

# Exact methods/doc IDs only; prerequisite reads must also be named.
pnpm smoke:free-api:real --read --allow=50558,alibaba.icbu.product.list
```

The script uses the existing Node credential provider, sequential calls with at least 350 ms spacing,
and one attempt per request. It never refreshes credentials, logs in, or falls back to Mock implicitly.
`--write` additionally requires `--read`, an exact reviewed allowlist and valid business prerequisites.
Do not use it while the recorded inventory outcome remains unresolved. A successful upload response
alone is not proof of processed/publicly queryable video; it must be read back before release enablement.

## Release boundary

This branch is an implementation and diagnostic iteration, not an automatic release. No mainline merge,
Cloudflare deployment or Chrome Web Store submission is included. ZIP remains limited to 1,500,000 bytes;
all existing unpacked, startup, background and permission gates remain unchanged.
