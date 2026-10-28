# 2.20.2 candidate readiness

## Scope and compatibility

Prepare the TOP application-file layout fix in 8a87804 on top of v2.20.1 (9b312ea). The action now follows the application heading, uses the existing green primary style inside a padded panel, and has instructions below it. English/Chinese, light/dark and desktop/narrow layouts are covered.

| Sub-capability                                            | TOP                                                                  | IOP                                         | Risk and acceptance                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Read application metadata from a local authorization JSON | Existing local parser; app details only, never imports the old token | This TOP-only action stays hidden           | Local read, no provider dispatch; file-chooser test verifies fields and zero token requests             |
| OAuth, renewal and workbench save                         | Existing TOP endpoints and guards unchanged                          | Existing IOP endpoints and guards unchanged | No new API, permission, credential migration or write allowance; isolated authorization regression only |

No new network client, registry mapping, default-protocol change, provider mutation, database migration or dependency is introduced. Mock fixtures are restricted to disposable test profiles and never become a production fallback.

## Verification and artifacts

Run release-version, the full pnpm check, Worker replay, Web/formal-MV3 E2E, BFF replay, authorization E2E, Node-credential E2E and the official v2.20.1-to-candidate upgrade checks on remote Windows. Do not rebuild the extension while browser tests use the output. The layout regression initially fails on the old heading/spacing, then verifies eight locale/theme/viewport combinations and file selection.

Verify the official v2.20.1 baseline against its published SHA-256. Upgrade checks use disposable offline profiles and confirm unchanged permissions and retained encrypted authorizations, preferences and task data, not the live user's browser profile.

Keep ZIP <= 2,000,000 bytes and unpacked files <= 5,470,000 bytes, without relaxing other gates. Generate the candidate with the existing deterministic packager and keep its checksum and release.json. Private logs, screenshots and receipts stay in ignored artifacts/release-2.20.2 or artifacts/top-application-backup-layout.

## Delivery boundary

Push the development branch and prepare a 2.20.2 candidate ZIP and bilingual listing notes. Do not promote staging/master, create a Tag/GitHub Release, deploy Cloudflare or submit Chrome Web Store without a later instruction. Do not replace v2.20.1, its Release or its ZIP. Update the planned release date if formal publication happens on another day.
