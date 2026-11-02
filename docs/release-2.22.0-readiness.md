# 2.22.0 candidate readiness

## Scope and compatibility

Base this candidate on the existing 2.21.0 mainline and the reviewed
`codex/inventory-readback-evidence` work. The release adds scoped read-only
quantity evidence to the inventory workspace and shared product drawer. It does
not add inventory writes, provider methods, permanent permissions or dependencies.

| Source                               | TOP only / legacy unmarked TOP | IOP only                    | Dual authorization, either default |
| ------------------------------------ | ------------------------------ | --------------------------- | ---------------------------------- |
| Product warehouse records            | Existing TOP reader            | Existing IOP reader         | IOP                                |
| SKU warehouse records                | Existing TOP reader            | Unsupported before dispatch | TOP                                |
| Native SPU and SKU quantity evidence | Requires IOP before dispatch   | IOP get/v2                  | IOP get/v2                         |

Each source uses its actual operation/payload context. No photo-upload context,
silent protocol fallback, warehouse sum or inferred zero is used. Normal token
refresh does not rebind a running task. Quantities remain scoped and preserve
exact long-integer strings; unsafe, fractional and negative numeric quantities
are unavailable.

The get/v2 contract accepts String or Number only at seven observed leaves
(weight, three dimensions, SPU inventory, SKU inventory and SKU price). The
broader response and unrelated methods retain validation.

## Real acceptance and limits

Remote Node BFF and formal MV3 isolated profiles passed nonempty reads for TOP
only, IOP only, dual TOP-default and dual IOP-default. The inventory workspace
and shared drawer were checked with all three sources. Unsupported sources
refused without provider requests. Native SPU zero and positive SKU quantity
were retained separately, not combined.

An exact-product search in the remote official product list and a read-only
inspection of its editor confirmed the displayed variant quantity. The editor
did not expose its warehouse code or native SKU identifier. The official list
and editor also disagreed on the product-type label; both observations are
retained separately, with no attempted product-type change. Private receipts and
screenshots remain ignored under `artifacts/inventory-ui-20261102/`.

The controlled IOP plus-one attempt was explicitly rejected with `ApiCallLimit`.
Fresh same-protocol IOP and TOP readbacks retained the baseline. No subtraction,
retry, cross-protocol resend or quota bypass was attempted. **Inventory mutation
and restoration acceptance remains blocked, not passed.** No UI write entry or
write allowlist is expanded for this release.

See [inventory evidence](inventory-readback-evidence.md) for the exact technical
boundary. Successful isolated tests do not establish native permission-consent
acceptance or universal account/provider coverage.

## Release gates

Run the complete Windows quality, contract, type, unit, Worker, Web/formal-MV3,
BFF replay, authorization and Node-credential suites. Build before browser tests
and never rebuild a loaded extension output concurrently. Check a disposable,
offline upgrade from a published checksum-verified baseline and keep the real
user profile unchanged.

Keep the existing final ZIP limit of 2,000,000 bytes, unpacked limit of 5,470,000
bytes and all per-chunk/security gates. Package reproducibly using the repository
script, verify the manifest/version, archive contents and SHA-256, and keep the
release metadata alongside the remote ZIP.

Preparation does not publish a store version, deploy Cloudflare, create a Tag or
GitHub Release, or merge the mainline. Those external steps remain separate from
reaching a releasable candidate. Record completed checks and artifact metadata
after this candidate's exact source has passed.
