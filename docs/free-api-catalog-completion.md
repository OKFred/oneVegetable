# Free API catalog: public documentation preparation

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
read-only smoke test. Such tests must still pass actual platform authentication and API grants;
no bypass, placeholder success or automatic account verification is permitted. This preparation
does not execute any account/business requests, including read-only calls.

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
