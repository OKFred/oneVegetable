# 2.20.1 release readiness

## Scope

Ship the product-score queue recovery already integrated in 6bbc7137cd2ab64ac300f7cdb7bb4a113fa42854. The fix branch CI passed in full on its second attempt; staging and master subsequently passed. The first attempt's unrelated template ZIP download timeout and three successful remote repetitions remain recorded in ignored artifacts.

The release preparation changes seven workspace versions, listing metadata, bilingual release notes and their generated outputs. The storage permission justification is aligned with the existing manual-view-lock implementation and privacy policies: workbench locking retains background API recovery keys and clears independent authorization-tool recovery keys in passphrase mode. The compliance gate requires both distinctions. No new API, dependency, manifest permission, credential migration, default protocol or provider write allowance is introduced.

## Protocol and safety boundary

- TOP score reads keep alibaba.icbu.product.score.get with the exact product's resolved obfuscated ID.
- IOP keeps /icbu/product/score/get with the canonical plaintext product ID.
- Both default-protocol combinations retain operation-and-payload routing. Before/after account and read-context checks stay in place; failures do not switch protocols.
- Completed reads use the existing scoped cache. Pausing stops subsequent records without aborting a dispatched read; obsolete account/configuration results are discarded.
- This release operation does not renew authorizations, modify products/inventory, deploy the Worker or submit the Chrome Store.

## Gates and immutable artifacts

Run Windows release-version, formatting, lint, i18n, contracts, types, all unit tests and three runtime builds. Run Worker replay, full Web/formal-MV3 E2E, BFF replay, authorization and Node-credential E2E serially; never rebuild the extension while browser tests use its output.

Verify upgrades from the official v2.20.0 ZIP and its published SHA256, not from the candidate itself. Check unchanged permissions and retained encrypted credentials, preferences and local tasks in a disposable offline profile.

Keep final ZIP <= 2,000,000 bytes and unpacked files <= 5,470,000 bytes; other bundle/security gates remain unchanged. Packaging verifies deterministic ZIP bytes and archive file names. Exclude secrets, account files, local profiles, Mock datasets and development-server code from deliverables.

After validation, promote to staging/master, create the new annotated v2.20.1 tag, and let Publish formal release rebuild that immutable tag and create GitHub Release assets. Do not replace v2.20.0 or reuse its package. Download the published ZIP and compare SHA256 before handing it to the user for manual Store upload.

Private receipts live under ignored artifacts/release-2.20.1; only sanitized release materials belong in Git.
