# Authorization assistant: selected second design

Date: 2026-10-21

## Comparison target and evidence

- Source visual truth: `artifacts/authorization-release-ready-ui/reference-second-design.png` (the user's selected second green design).
- Implementation: the formal MV3 build's `authorization.html?protocol=top`, with an imported fixture authorization ready to save to the workbench. No real credentials appear in these visual captures.
- Source: 1487 x 1058 pixels. Desktop implementation: 1488 x 1058 CSS/pixel viewport, device scale factor 1. The source is placed at its original scale with one pixel of padding, not stretched.
- Full-view comparison: `artifacts/authorization-release-ready-ui/design-comparison.png`, source left / implementation right.
- Focused heading, copy and primary-action comparison: `artifacts/authorization-release-ready-ui/design-comparison-detail.png`, source left / implementation right, same 545 x 470 crop from each image.
- Final dark and light captures: `artifacts/authorization-release-ready-ui/selected-layout-dark.png` and `selected-layout-light.png`.
- Responsive capture: `artifacts/authorization-release-ready-ui/selected-layout-mobile-en.png`, 390 x 844 CSS viewport, device scale factor 1, full-page capture 375 x 1353 pixels (native vertical scrollbar excluded by Chromium).

## Findings and comparison history

The first comparison was blocked by the following findings. All were corrected and the final rendered captures were compared again with the selected source.

1. [P2, fixed] Completed progress badges showed a number and check simultaneously. The Vue icon renderer appended to existing text. Clear the badge before mounting the check. Final dark/light captures show one symbol per badge.
2. [P2, fixed] The application-name label wrapped unnecessarily. Use the short translated summary label, while keeping technical descriptions in the editable form. Final desktop captures show readable, aligned label/value rows.
3. [P2, fixed] Region proportions and spacing drifted from the selected three-column composition. Set the desktop rail to 238px, align the main/summary tracks, and restore the primary-action spacing. The final combined full-view comparison confirms the intended rail / action / metadata hierarchy.
4. [P2, fixed] An additional protocol disclosure competed with the ready-state primary action. Keep protocol changes behind the expanded management area when ready; retain normal access before connection. The final capture has one prominent next action.
5. [P1, fixed] Manually selecting light mode while Windows prefers dark left some headings light on a light surface, due to legacy section color rules. Apply the shared foreground token to the scoped authorization sections. The recaptured light image has dark readable headings; a browser regression assertion verifies both heading colors match the page foreground.

No actionable P0/P1/P2 findings remain in the compared states.

## Required fidelity surfaces

- Fonts and typography: retain the application's system font stack and native CJK fallback. The source's generated lettering is not a reproducible font asset. Use a clear heading/body/metadata hierarchy without reproducing raster text; the focused comparison verifies wrapping and optical weight. Slightly smaller body text than the generated concept is an intentional workbench-consistency choice.
- Spacing and layout rhythm: retain the three desktop regions, generous central action spacing and separate metadata column, without introducing extra cards. Below 900px, move progress above content; narrow layouts stack action before metadata without horizontal overflow. The primary button is 64px high; ordinary authorization-tool controls retain their existing 44px touch targets.
- Colors and tokens: import the workbench's unchanged green semantic tokens, including dark primary `rgb(44, 201, 143)`. Light and dark surfaces, focus states, borders and muted text use the same tokens. No blue primary action or invented gradient is added.
- Image quality and assets: use the existing packaged application icon and Lucide UI icons, not generated substitutes or handcrafted SVG/CSS art. The current repository icon is a leaf rather than the concept's sprout; this is an intentional existing-brand constraint. Icon checks and metadata remain crisp at density 1.
- Copy and content: use "Authorization ready" rather than "Platform authorization successful" for imported bundles, which are not automatically live-verified by import. Short instructions identify the remaining save step. The metadata column exposes protocol, app name, masked key and available expiry; secrets never appear. The preservation notice explains that the other protocol and saved defaults are unchanged.

## Interaction and browser evidence

- Full authorization browser suite: 33 passed, including TOP/IOP callback focus return, direct workbench save, import/export confirmation, protocol isolation, cancellation, language/theme, mobile layout and keyboard-ready HTML dialogs. Provider endpoints in this suite are isolated fixtures.
- Workbench formal-extension guide/import E2E: 2 passed.
- Workspace unit suite: 348 files / 3130 tests passed.
- Genuine remote TOP verification: existing saved TOP bundle imported through the formal extension UI, saved to the workbench, then a real product-list read succeeded with one record. No new real OAuth consent, token renewal, product mutation or default-configuration replacement was performed in this genuine acceptance run. Its isolated profile was discarded after testing.
- The genuine remote acceptance helper observed zero page errors. Builds, type checks, OpenAPI drift and bilingual-key checks passed separately; they are not substituted for visual inspection.
- The final visual captures include a temporary success notification. It does not reflow the three-column layout; the browser test verifies the document position of the ready heading remains stable.

## Implementation checklist

- [x] Match the user's selected second design and existing green theme.
- [x] Keep one main save/open-workbench action and directly visible safe metadata.
- [x] Collapse backup and management actions without removing them.
- [x] Keep TOP reauthorization and existing-bundle import explicit; recommend IOP to new merchants.
- [x] Verify light/dark, Chinese/English, desktop/mobile and protocol isolation.
- [x] Preserve existing workbench data and permissions; do not deploy or publish.

## Follow-up polish

- The preview uses the application's existing packaged icon and system fonts intentionally. Rebranding or replacing the logo is outside this change.
- A fresh real IOP/TOP OAuth consent or renewal was not repeated for this visual iteration; only the remote TOP import/save/read path was live-verified.

final result: passed
