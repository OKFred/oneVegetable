# Product video association contract

Documentation checked 2026-09-21 against the official [main API](https://developer.alibaba.com/docs/api.htm?apiId=50089) and [detail API](https://developer.alibaba.com/docs/api.htm?apiId=50088). Evidence for these mutation APIs is documented contract/mock verification only, **not account acceptance of writes**. A separate read-only smoke can confirm an existing association without accepting either write API. Both generic capabilities remain `verification: documented`, `realCallEnabled: false`.

## Public interface

`VideoAssociationAdapter(client, validateCapabilityRequest, validateCapabilityResponse, options?)` is exported from `@one-vegetable/core/video-association`. Options are `{ realCallEnabled?: boolean, wait?: (ms: number) => Promise<void> }`. Only literal `realCallEnabled: true` enables `associate`; the default returns `rejected / VIDEO_ASSOCIATION_DISABLED` without any call. It is a trusted upstream policy decision, never a request field or substitute for authorization. Runtime gateways must remain disabled until separate acceptance, and construct all clients with `maxAttempts: 1` and no transport retries.

- `associate(request: VideoAssociationRequest): Promise<VideoAssociationResult>`
- `verify(request: VideoAssociationVerifyRequest): Promise<VideoAssociationResult>`

Association request: `{ productId: string, videoId: string, encryptedVideoId: string, type: 'main' | 'detail', language: 'zh_CN' | 'en_US', confirmed: true }`. Verification omits `confirmed` and rejects extra fields. IDs are positive canonical decimal strings; the encrypted video ID is opaque, compared exactly and never trimmed. Numeric video preflight and the existing exact `ProductAdapter.getSummary` require safe integers: unsupported large IDs fail closed rather than being rounded. Product IDs remain strings in mutation payloads.

Result: `{ outcome: 'confirmed' | 'unconfirmed' | 'rejected' | 'unknown', traceId: string | null, code: string | null }`. Local failures use local codes; provider receipts preserve the write code and trace even when readback fails. No raw response, error message, or credentials are exposed. Validators live in the separate `generated/validators-video-association.ts` slice.

HTTP contract operations: `associateProductVideo` at `POST /videos/associate`, and `verifyProductVideoAssociation` at `POST /videos/verify-association`.

## Preconditions and evidence

Before one mutation call, the adapter copies the validated target, queries `VideoAdapter.list({ id, page: 1, pageSize: 20 })`, requires exactly one matching plain/encrypted video pair, and checks exact product existence through `ProductAdapter.getSummary(productId, language)`. No full-shop lookup or product schema read/write is used. Calls are sequential with 300 ms gaps. Failures before sending cannot have written and return `rejected` from association.

Both provider methods require String `video_id` and String `product_id`. Responses declare Boolean `model`, String `msg_code`, and String `msg_info`. Main acceptance requires strictly `model === true && msg_code === '00000'`, but still needs readback to become confirmed. A true model with a contradictory or absent main code is `unknown`, never a definite rejection. Explicit false models/rejections stop immediately. Timeouts, malformed responses, and transport uncertainty after sending are `unknown` and are not automatically retried or followed by another mutation.

The detail documentation's sample is **INVALID JSON**: its Boolean model contains the unquoted placeholder `结果`. `snapshot-video-docs.ts` records the original sample and an explicit type-only override (`model: false`) to keep schema/replay examples valid. Its `msg_code: 'code'` is a placeholder, **not a documented success code**. No detail success code is inferred from main, query, or relations. A true detail model is provisional/unconfirmed unless readback proves the association.

## Read-only verification

Readback uses `VideoAdapter.related` with the exact encrypted video ID and requested main/detail type, then decrypts encrypted product IDs sequentially with 300 ms gaps. It never fetches every product or uses schema rendering. At most ten distinct candidates may be checked; if the returned set exceeds ten, it returns `unconfirmed` without scanning. An empty list, missing target, malformed ID, permission error, or any read error stays unconfirmed. Permission failures stop immediately. Confirmation requires the exact decrypted decimal product ID, not merely a successful relation/decrypt response. Ten calls is a request-count bound, not a guarantee that a slow upstream meets a BFF deadline.

`verify` is always read-only, even if explicitly enabled for association, and repeats target preflight. **No verification failure ever returns `rejected`**: failed reads, invalid input, mismatched pairs, or disappeared products cannot prove a prior write was rejected and must not unlock an unresolved receipt. Verification reports current matching state only; it does not prove which earlier attempt caused it.

Fixture data is synthetic under `mock/data/video/association-core.json`; live-account writes, replacement/recovery rules, and account-level acceptance have not been exercised.
