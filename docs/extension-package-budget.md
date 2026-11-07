# Extension package budget

Current authorized repository policy (decimal bytes, not MiB or a Store platform limit):

- Final Store ZIP: at most **2,500,000 bytes (2.5 MB)**.
- Unpacked extension: at most **8,500,000 bytes (8.5 MB)**.
- Dedicated lazy packing Three.js vendor chunk: at most **1,000,000 bytes (1 MB)**.
- Shared bilingual i18n chunk: at most **350,000 bytes (350 KB)**, explicitly increased from 310,000 bytes on 2026-10-21.

On 2026-11-05 the user allowed a modest package-budget increase for the S3 file manager. The unpacked cap is raised from 5,470,000 to 7,000,000 bytes to accommodate the bundled VueFinder component. The final ZIP cap remains 2,000,000 bytes; no runtime, security or startup-JavaScript limit is relaxed.

On 2026-11-07 the user authorized the browser-local 3D packing preview, raising the ZIP and unpacked caps to 2,500,000 and 8,500,000 bytes. Only the dedicated lazy `packing-three` vendor chunk may exceed the normal 500,000-byte Web chunk budget, up to 1,000,000 bytes. The vendor must not enter any background or eager page graph. Its local packing Worker is limited to 50,000 bytes; other business chunks, startup and security gates are unchanged.

`scripts/lib/extension-package-budget.ts` exports both limits and assertions. Exactly the limit is accepted; one byte more, negative or fractional counts, non-finite values and unsafe integers are rejected. The packager checks the final ZIP before writing release files; the bundle checker applies the shared unpacked assertion and retains aggregated diagnostics.

All other gates remain unchanged: background 100,000 bytes, each eager page chunk 800,000 bytes, Options eager JavaScript 250,000 bytes, product transfer worker 50,000 bytes, and existing worker graph, Manifest permission, source-map and security checks. Raising the i18n limit does not raise the ZIP, unpacked, startup-JavaScript or worker limits.

Historical validation reports retain the limits used for those runs. This policy change is not evidence of a new build, live acceptance, release or Store submission.
