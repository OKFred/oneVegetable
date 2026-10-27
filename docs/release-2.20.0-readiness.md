# 2.20.0 release readiness

## Scope

Integrate the product quality assessment-to-editing workflow and status display refinements after v2.19.1. Product score requests use the protocol-selected identifier. Task badges stay on one line; order, payment and logistics codes have independent bilingual labels and explicit unknown-code handling. No provider write capability, authorization scope or extension permission is added.

The feature source is 896664830568bc3d03689c602d0e3a406a8d0965, including the existing three product-quality commits. Its feature CI and 3,781 remote pre-push tests passed. New version validation remains separately recorded.

## Build boundary

Prepare release metadata and all release builds in the isolated remote worktree. Keep the active primary extension output, credentials and task records intact. Update seven workspace manifests (including auth-pages), Store listing version, bilingual release notes and their generated files. Dependencies and lockfile remain unchanged.

## Gates and promotion

Run release-version validation, pnpm check, Worker tests, full E2E, isolated BFF replay, authorization E2E and Node credentials checks serially. Build/package only after each browser suite closes. Validate upgrades using the prior official ZIP and its verified SHA, never the current candidate as its own baseline.

Promote feature to staging, then the verified release tree to master. The stable annotated v2.20.0 tag must point to a commit on origin/master. The formal GitHub workflow rebuilds that immutable tag and publishes the ZIP, SHA256 and release metadata. Never move an existing tag or replace an existing Release.

The installed development candidate is not the formal release receipt. Final CI, commit and artifact checksums are authoritative. No Chrome Web Store submission or production Cloudflare deployment is included in this release operation.

## Validation results

Local gate receipts are kept in ignored artifacts/release-2.20.0 and checked before promotion. The immutable tag workflow and published package metadata provide the final release result. No credentials or raw account acceptance records belong in this document.

## Saved authorization import regression

The staging push gate [40490158811](https://github.com/OKFred/oneVegetable/actions/runs/40490158811) exposed a saved-import navigation race. A persisted authorization model remained dirty while asynchronous authorization metadata refreshed, causing the unsaved-edit dialog to block navigation. The clean baseline now follows the persisted model before that refresh.

Regression coverage delays metadata refresh and checks both immediate navigation after saving and protection of subsequent real edits. The original fast-navigation media E2E remains intact. Original failure diagnostics and replacement candidate receipts are retained under ignored release artifacts.
