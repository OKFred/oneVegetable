# Extension package budget

Current authorized repository policy (decimal bytes, not MiB or a Store platform limit):

- Final Store ZIP: at most **2,000,000 bytes (2 MB)**.
- Unpacked extension: at most **5,470,000 bytes (5.47 MB)**.

The unpacked budget follows the ZIP increase from 1,500,000 to 2,000,000 bytes proportionally, rounded upward from the previous 4,100,000-byte budget to the authorized 5,470,000 bytes.

`scripts/lib/extension-package-budget.ts` exports both limits and assertions. Exactly the limit is accepted; one byte more, negative or fractional counts, non-finite values and unsafe integers are rejected. The packager checks the final ZIP before writing release files; the bundle checker applies the shared unpacked assertion and retains aggregated diagnostics.

All other gates remain unchanged: background 100,000 bytes, each eager page chunk 800,000 bytes, Options eager JavaScript 250,000 bytes, product transfer worker 50,000 bytes, bilingual i18n chunk 310,000 bytes, and existing worker graph, Manifest permission, source-map and security checks.

Historical validation reports retain the limits used for those runs. This policy change is not evidence of a new build, live acceptance, release or Store submission.
