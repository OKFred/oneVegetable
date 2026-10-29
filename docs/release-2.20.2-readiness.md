# 2.20.2 candidate readiness

## Scope and compatibility

Prepare the TOP application-file layout fix and dual-authorization handoff fixes on top of v2.20.1 (9b312ea). The file action follows the application heading, uses the existing green primary style inside a padded panel, and has instructions below it. Continuing another protocol first saves the current authorization, then switches after an explicit success receipt; a failure offers retry or an explicit switch without saving. Hide this action when the other profile is already saved to the workbench, not merely ready in the tool. English/Chinese, light/dark and desktop/narrow layouts are covered.

| Sub-capability                                            | TOP                                                                  | IOP                                         | Risk and acceptance                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Read application metadata from a local authorization JSON | Existing local parser; app details only, never imports the old token | This TOP-only action stays hidden           | Local read, no provider dispatch; file-chooser test verifies fields and zero token requests             |
| OAuth, renewal and workbench save                         | Existing TOP endpoints and guards unchanged                          | Existing IOP endpoints and guards unchanged | No new API, permission, credential migration or write allowance; isolated authorization regression only |

No new network client, registry mapping, default-protocol change, provider mutation, database migration or dependency is introduced. Mock fixtures are restricted to disposable test profiles and never become a production fallback.

Button visibility reuses the existing local `protection-status.pool` TOP/IOP booleans and local storage-change notifications. It adds no provider request or credential exposure. Clearing the other workbench profile restores its setup action. Saved authorizations and defaults survive refresh; the last profile can still be saved normally.

The final candidate also shortens the bilingual IOP photo-group mismatch message and its next-action guidance. The error still means that the returned group does not match the requested group; it does not establish that the platform has not finished developing the feature. Group-scope validation, error codes, protocol selection and retry behavior are unchanged.

## Verification and artifacts

Run release-version, the full pnpm check, Worker replay, Web/formal-MV3 E2E, BFF replay, authorization E2E, Node-credential E2E and the official v2.20.1-to-candidate upgrade checks on remote Windows. Do not rebuild the extension while browser tests use the output. The layout regression initially fails on the old heading/spacing, then verifies eight locale/theme/viewport combinations and file selection.

Verify the official v2.20.1 baseline against its published SHA-256. Upgrade checks use disposable offline profiles and confirm unchanged permissions and retained encrypted authorizations, preferences and task data, not the live user's browser profile.

Keep ZIP <= 2,000,000 bytes and unpacked files <= 5,470,000 bytes, without relaxing other gates. Generate the candidate with the existing deterministic packager and keep its checksum and release.json. Private logs, screenshots and receipts stay in ignored artifacts/release-2.20.2 or artifacts/top-application-backup-layout.

## Delivery boundary

For the authorized final delivery, push this development branch, wait for its exact commit to pass CI, then promote staging/master and refresh the final 2.20.2 ZIP on both the remote and local artifact directories. Verify it against the same passing CI artifact and keep old candidate checksums separate. This final ZIP supersedes both the layout-only candidate and the earlier handoff-only package. Do not create a Tag/GitHub Release, deploy Cloudflare or submit Chrome Web Store without a later instruction. Do not replace v2.20.1, its Release or its ZIP. Update the planned release date if formal publication happens on another day.
