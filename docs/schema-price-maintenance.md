# Schema price-only maintenance

## Scope and protocol preflight (2026-11-02)

Reuse the existing updateProduct lifecycle and safe Schema patch serializer. Only
amounts in existing tiered prices are editable. Keep currency, pricing mode,
quantity thresholds, units, SKU identities and all non-price roots unchanged.
Range/SKU conversion, bulk pricing, native price writes, stock changes and draft
deletion are outside this change.

| Dependency                       | TOP                                        | IOP                          | Risk / evidence                                    |
| -------------------------------- | ------------------------------------------ | ---------------------------- | -------------------------------------------------- |
| Schema read                      | alibaba.icbu.product.schema.render         | /icbu/product/schema/render  | Read; already adapted                              |
| Incremental update               | alibaba.icbu.product.schema.update         | /icbu/product/schema/update  | Mutation; existing operation, no broader allowlist |
| Independent protected-field read | Completeness not established for this flow | /alibaba/icbu/product/get/v2 | Read; existing typed reference client              |
| Preview/validation               | Local                                      | Local                        | No provider mutation                               |

First acceptance uses an isolated IOP configuration, including when TOP is the
default in a dual configuration. TOP-only users retain the existing editor but
cannot bypass missing independent integrity evidence in this dedicated flow.
Do not change defaults, mix credentials or fall back after a provider error.
Documentation, account permission, acceptance and final readback are distinct.

## Implementation reach

- Shared price-root patch generation, canonical money, existing protected hashes.
- Existing updateProduct request, field expectations and task validation.
- Node/Worker lifecycle and trusted extension dispatch/readback.
- Dedicated lazy price dialog at the existing product-list entry; bilingual UI.
- Synthetic fixtures, core/API/MV3/UI tests and remote acceptance scripts.

Store the price-only evidence with the existing field expectation JSON, not a
new task database or full Schema copy. Persist before dispatch. Historical
native tasks are unchanged and are never rebound to Schema updates.

## Safety and acceptance

Re-read state, original price structure and protected fields immediately before
dispatch. A mismatch requires a fresh preview. The patch contains ladderPrice
and the existing modelNumber root. Only price amounts change; the model number
comes from the independent current reference, never editable input. Preserve all
other roots and price children/attributes. Reject missing model evidence,
conflicting values, missing/read-only model roots and unsafe structures.
This is a pre-dispatch conflict check, not an Alibaba atomic version lock.
Avoid simultaneous edits of the same product from other clients.

This two-root exception is required by remote acceptance: an approved IOP update
containing only ladderPrice cleared the test model in both get/v2 and Schema.
The integrity guard caught it and stopped; the user explicitly approved a
single minimal price-and-model restoration. Never treat the original price-only
attempt as successful, and never automatically repair or retry such a task.
No-op prices send nothing, even when the rendered model root is empty.

Browser and server XML serializers differ in empty-tag spacing. Preflight normalizes
only whitespace before `/>` outside quoted values, comments and CDATA; every other
byte must still match the freshly generated safe patch.

HTTP/provider acceptance is pending, not completion. Final verification requires
approved product state, matching target prices and complete matching protected
hashes. Errors, omissions and unknown outcomes do not become success. All writes
are single-attempt; manual readback must never resend. Configuration replacement,
storage failure, concurrent edits and page departure stop further scheduling.
IOP render can omit the preserved model value. Only that omission may use the
independent get/v2 model hash; a conflicting nonempty Schema value still blocks
verification. The trusted backend/worker, not the page alone, checks the reference.

Remote live acceptance uses only the existing newly-created unbranded test
products after checking identity, baseline and blocking receipts. Send one small
legal price change, verify by API and official page, then restore through a
second independently persisted request and verify again. Restore only after the
temporary value and protected fields are confirmed; never blindly compensate.
Keep sensitive evidence under ignored artifacts. Do not merge, deploy, release,
replace official ZIPs or enable native price/stock/draft mutations in this turn.

## Remote evidence so far

- Synthetic focused tests and browser E2E cover preparation and no false success.
- Formal MV3 uses the actual bundled worker with local XML parsing; an invalid
  guard is rejected before job creation or provider mutation.
- The first IOP price-only mutation was accepted and later approved, but failed
  protected-field verification. All other protected hashes matched.
- The separately approved two-root restoration returned the original price,
  model and matching protected hashes after final approval. Evidence is in the ignored remote
  artifacts/product-api-workbench/schema-price-manual-recovery-20261102 folder.
- The revised guarded Node flow changed 1.00 to 1.01 and reached verified with
  all protected hashes intact. A fresh formal MV3 task restored 1.00 and also
  reached verified, with the original model and all protected hashes intact.
  Each stage dispatched exactly one write; neither task was rebound across runtimes.
- Automatic checks: 5,102 unit tests, 31 workerd tests, 28 related browser E2E
  and 57 formal MV3 authorization/compatibility E2E;
  format, lint, i18n, contract/type checks and all three builds passed.
- ZIP measured in memory: 1,509,372 bytes; unpacked: 5,131,984 bytes. Existing
  package limits and the official ZIP were not changed.
