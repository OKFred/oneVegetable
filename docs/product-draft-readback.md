# Product draft presence readback

## Scope and protocol matrix

This reader proves only an observed draft state. It never returns `absent`, enables
draft deletion, creates drafts, scans product lists or calls website-private APIs.

- IOP: `/alibaba/icbu/product/status/get/v2`, cid11, public read, user authorization.
  Request: one `product_id`. Native response: explicit `code=0`,
  `result.success=true`, and `result.data.status`.
- Only exact lowercase `draft` is `present`. All other statuses (including
  `deleted`, future values, `online`, `failed`, `pending`) are `unknown`.
- TOP: no inferred equivalent, no automatic fallback. A TOP-only/currently
  switched context is `unknown` without dispatch.
- Source: [public IOP status documentation](https://openapi.alibaba.com/doc/api.htm#/api?cid=11&path=%2Falibaba%2Ficbu%2Fproduct%2Fstatus%2Fget%2Fv2&methodType=GET%2FPOST).
  The public document lists no independent deleted/absent state or unambiguous
  draft-not-found contract. A deletion acknowledgement is not readback.

## Core API

Import directly from `@one-vegetable/core/product-draft-readback`; package export
integration belongs to the parent.

```ts
readProductDraftPresence(
  input: ProductDraftReadbackInput,
  dependencies: ProductDraftReadbackDependencies
): Promise<ProductDraftReadbackResult>
```

Input consists of `draftId`, `protocol`, `context` and a trusted receipt:

```ts
{
  kind: 'draft',
  source: 'draft-create' | 'draft-list',
  verified: true,
  receiptId: string,
  draftId: string,
  protocol: 'iop',
  context: { identity: string, gateway: string },
  observedTimeUtc: number,
  expiresTimeUtc: number
}
```

Resolve receipts from authenticated account-scoped storage, not a submitted UI
object, a formal-product query, or an arbitrary ID. A draft-list source must
actually be draft-specific; an ordinary product list is not eligible.
The runtime `KnownProductDraft` three-field structure alone is insufficient:
the parent must supply protocol/context, trusted source and explicit freshness.

Dependencies are a fixed-credential single-attempt `client.call`, live
`getCurrentContext`, the existing `validateCapabilityRequest/Response`, and
optional `now/requestId`. The call receives `maxAttempts:1`,
`allowRefresh:false`, `allowProtocolFallback:false` and the pinned context.
Construct the actual Alibaba client with `maxAttempts:1`; never wrap it with
credential refresh, retry or alternate-protocol logic.

The reader checks scope and receipt expiry across asynchronous boundaries.
Unsafe IDs throw the fixed `DRAFT_READ_ID_INVALID` error before dispatch.
Stale/mismatched receipts, validation failure, permission denial, timeout,
unsupported methods and uncertain responses return `unknown`. Error messages
and response bodies are not copied into results.

The result includes `draftId`, `status`, a fixed `reasonCode`, local correlation
`requestId`, `checkedTimeUtc` and `attempts:0|1`. Returned `draftId` is request
correlation, not a synthesized provider echo. The status proof comes from the
documented status query, never `ProductAdapter.get().id`.

The parent can project the result to `{ draftId, status }` for
`runtime.readDrafts`. Merely adding that callback must not unlock deletion:
the independent deletion acceptance gate remains closed.

## Source contract registration

The native method and reference path are appended after the existing six
reference entries (schema index6); no previous schema index is changed.
The native request allows only `product_id`; the normalizer preserves the
native result wrapper and requires actual code/success, without manufacturing
a TOP response. The source response contract requires code0 and a result with
explicit boolean success and object data. Unknown status strings remain valid
shape but are not draft-presence proof.

Generation belongs exclusively to the parent. The saved
`docs/alibaba-iop-api-docs.json.documents` must contain the complete status
document, not only its catalog title. The independently compiled source-schema
test intentionally fails if that authoritative detail is absent.

## Standalone read-only smoke

The operator must provide an existing **verified IOP saveProductDraft
ProductMutationJob export** as one JSON object. Required fields are `id`,
`operation`, `status`, `protocol`, `productId`, `creatorId`,
`productContext` and `completedTimeUtc`. Do not fabricate a receipt or use
a publish-product/deletion acknowledgement. Credentials and receipt must be
explicit ignored files under the remote worktree or named primary repo.

```powershell
pnpm exec tsx scripts/smoke-product-draft-readback-real.ts --confirm-readonly --iop-credential=<ignored-IOP-bundle> --draft-receipt=<ignored-existing-job-export> --draft-id=<exact-receipted-draft-id> --actor-id=<actual-job-owner> --receipt-max-age-ms=<explicit-policy-duration> --output=artifacts/product-api-workbench/<new-report>.json
```

The owner and credential-derived context must match the receipt. Known expired
IOP authorization, missing/expired evidence or bad output paths stop before
dispatch. There is no env/vault/browser discovery, refresh, create/delete,
pagination or account-wide scan.

The NetworkManager transport guard permits only one POST to the fixed public
IOP status path with the fixed ID and requestId; it denies TOP fields, extra
business parameters, refresh/write URLs, redirects and a second send.
Reports contain only method/protocol, local requestId, present/unknown,
fixed reason and counts. They omit draft/receipt IDs, actor/context hashes,
credentials, raw status descriptions, XML and provider messages. Output uses
exclusive create and correlation is persisted before any request.

## Evidence gates

- Public method and semantics: documented (anonymous public docs checked).
- Core reader and native serialization/normalization: synthetic offline tests.
- Generated contract integration: parent generation and checks required.
- Actual account permission and draft-presence acceptance: not implied by tests.
- Actual status capability: the parent's formal-product-only probe returned HTTP200
  with a strict ISP upstream-error envelope, not a successful status response.
  Record upstream-error / not accepted; this proves neither draft presence nor deletion.
  No default success is added. The normalizer emits static, non-retryable
  ALIBABA_IOP_UPSTREAM_ERROR; the reader retains READ_FAILED / unknown.
- Independent absence/deletion verification: unsupported; deletion stays disabled.
