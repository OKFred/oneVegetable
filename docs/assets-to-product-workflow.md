# Assets to a new product (2.18 development)

## Protocol preflight

The workflow reuses existing public methods. No new Alibaba write permission is
introduced. Selection and opening the editor do not upload or publish anything.

| Dependency                                | TOP                               | IOP                                                   | Boundary                                                                                    |
| ----------------------------------------- | --------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Existing images, photobank.list           | Supported and previously verified | Adapted but group scope remains unverified            | Keep the cross-group guard; do not simulate an all-images query or fall back after failure. |
| Categories, category.get.new              | Supported                         | Public category/get mapping supported                 | Use returned category IDs and the current API language.                                     |
| Fresh product schema, product.schema.get  | Supported                         | Supported for wholesale; parameter restrictions apply | Resolve using the actual category, market and language.                                     |
| Platform draft, product.schema.add.draft  | Supported                         | Adapted and previously verified                       | Explicit submission, durable receipt, then draft readback.                                  |
| Publish, product.schema.add               | Supported                         | Adapted and previously verified                       | Explicit confirmation; accepted is not yet verified.                                        |
| Edit, product.schema.update               | Supported                         | Adapted and previously verified                       | New test product only during this iteration's live acceptance.                              |
| Display, product.batch.update.display     | Encrypted identifiers             | Plain product IDs and explicit IOP identity           | Preserve the protocol-specific lifecycle and readback.                                      |
| Description templates / local batch queue | Local or BFF feature              | Local or BFF feature                                  | Do not require a particular Alibaba protocol for editing or saving a local queue.           |
| S3 transfer regression                    | Independent SigV4                 | Independent SigV4                                     | Separate storage credentials; this selection workflow does not reupload images.             |

Registry evidence lives in packages/core/src/alibaba-iop-registry.ts and the
existing capability contracts. Previously verified methods are not equivalent to
this new workflow's live acceptance. Per-run account evidence stays in ignored
artifacts/assets-to-product-2.18; never commit credentials or full schemas.

Public protocol registrations used by these rows:

- alibaba.icbu.photobank.group.list: /icbu/product/photobank/group/list.
- alibaba.icbu.photobank.list: /icbu/product/photobank/list.
- alibaba.icbu.category.get.new: /icbu/product/category/get.
- alibaba.icbu.product.schema.get: /alibaba/icbu/product/schema/get.
- alibaba.icbu.product.schema.add.draft: /icbu/product/schema/add/draft.
- alibaba.icbu.product.schema.add: /icbu/product/schema/add.
- alibaba.icbu.product.schema.update: /icbu/product/schema/update.
- alibaba.icbu.product.batch.update.display: /icbu/product/update/display.

The left side is the TOP method; the right side is its explicitly registered
IOP path, not an inferred URL. Image-group listing is supported in both protocols;
that does not remove the separate IOP image-list scope limitation.

Existing TOP Schema writes use the registered Alibaba sync gateway; TOP is not
limited to its router/rest read endpoint. IOP uses its separately signed public
paths. Acceptance transport guards must account for this without widening the
application's method whitelist.

## Interaction and integrity

Select images on the current image page and choose "Use for new product".
The selection order determines the initial cover image. Choose a leaf category,
load its latest schema, then continue in the existing quick, guided or advanced
editor. Description templates and explicit queue/draft/publish actions are reused.

The app holds a one-use, expiring handoff in memory. The route contains only an
opaque identifier; no image URL, file ID or editing draft is saved automatically.
Refresh does not restore the selection. Saving to the local batch queue is still
an explicit user action.

Main-image fields support scalar, multi-input and validated fixed input slots.
URL, file ID and metadata are reused. Unsupported, read-only, occupied or
over-capacity fields fail atomically; images are not truncated or overwritten.
Remove excess images and retry, or explicitly cancel the handoff to edit manually.

Source-image and product-operation configurations are tracked separately.
Actual requests select with actual payloads and bind their selected context;
configuration snapshots are fences, not empty-parameter dispatch instructions.
Configuration changes and late results cannot silently move the work to another
account. A failed operation is never resent through the other protocol.

Creation verification now uses one exact product-ID list query in both BFF and
MV3, not a whole-store pagination scan. A missing or unrelated row stays pending;
it does not trigger another publish request.

S3 listings of a configured root preserve its directory boundary: a normalized
root such as imports/gallery is sent as prefix=imports/gallery/. Nonempty
relative filters keep their existing prefix-search semantics. Permission denials
never trigger a retry with an empty or broader prefix; out-of-root results are
rejected rather than silently filtered. Correct request construction alone is
not proof that a provider's restricted-key IAM supports the request.

## Remote acceptance: 2026-10-25

- TOP: one new platform draft was created and read with schema.render.draft.
- IOP: one new unbranded test product was published, title-edited, restored,
  taken offline and put online. Each write has a durable receipt and verified
  readback; the final state is online with the original title and unchanged
  post-publication image-field fingerprint. No retry or duplicate creation was used.
- MV3: real gallery selection and fresh-editor handoff were checked separately.
  The controlled provider-write lifecycle above was executed through Node BFF;
  this is not evidence of an independent MV3 write lifecycle.
- The platform returned a different image URL/file ID and a size variant.
  Side-by-side visual review matched the selected image. Literal URL, file-ID
  and binary equality are not claimed for that platform-generated variant.
- S3: a prefix-restricted key passed inside-prefix listing, one small PUT,
  GET/SHA-256 readback and final listing after a backed-up RustFS upgrade from
  alpha.94 to pinned 1.0.3. Outside-prefix listing remained denied with HTTP 403.
  A pre-upgrade test object also retained its original SHA-256. IAM conditions,
  keys, bucket policy and application credential defaults were not broadened.
- Private receipts and recovery details remain under the ignored
  artifacts/assets-to-product-2.18 directory, not in public fixtures.

These results do not remove the IOP photobank scope-mismatch guard or imply
that an unsupported protocol gained a capability. They do not constitute a
mainline merge, website deployment or Store release.
