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
- Serial reads, shared five-minute account/protocol/language cache, no automatic
  retries or protocol fallback. Stop subsequent reads on leave or account change.
- Preserve the assessment in memory while opening the existing editor. Explicit
  rechecks bypass stale caches; scores can lag behind platform review.
- Retain existing TOP-only, IOP-only, both default-protocol and legacy TOP tests.
- Real acceptance is read-only. This iteration does not publish, modify inventory,
  change authorizations, merge mainline, deploy Workers or submit the Store.

Implementation and acceptance results will be appended after verification.
