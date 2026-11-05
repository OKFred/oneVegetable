# Order fulfillment and S3 attachments

## Protocol preflight (2026-11-05)

This batch adds public IOP warehouse, freight and tracking reads and a separate,
administrator-confirmed attachment upload. No order placement, payment, shipping,
product/inventory modification or automatic attachment-to-order association.

| Capability                | TOP                                                      | Public IOP path                    | Evidence at start                                            |
| ------------------------- | -------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| Product warehouses        | No equivalent inferred                                   | `/warehouse/list`                  | Documented, not account verified                             |
| GGS warehouses            | No equivalent inferred                                   | `/alibaba/ggs/warehouse/list`      | Documented; GGS qualification required                       |
| Basic freight             | Existing restricted DropShipping method remains separate | `/shipping/freight/calculate`      | Documented, not account verified                             |
| Advanced freight          | Existing restricted DropShipping method remains separate | `/order/freight/calculate`         | Documented; actual company/product/address data required     |
| Tracking                  | Existing restricted DropShipping method remains separate | `/order/logistics/tracking/get`    | Documented; numeric trade ID, not an encrypted ID            |
| Attachment upload         | No equivalent inferred                                   | `/alibaba/order/attachment/upload` | Documented mutation; upload does not prove order association |
| Local/S3 source selection | Not applicable                                           | Not applicable                     | Local functionality; no Alibaba authorization required       |

Only these native paths select IOP before dispatch. TOP-only users retain all
existing features; unsupported new actions explain that IOP is needed. Dual
authorization uses actual method and parameters, not a borrowed photo context.
No fallback or automatic retry follows a platform error. Account grants and
final business acceptance are recorded separately from documentation/adapter status.

S3 ordinary files and attachments are at most 5 MB (5,000,000 bytes). The public
attachment document says 5M without defining MB/MiB, so the implementation uses
the conservative decimal cap. Attachments must be validated by type, signature, declared
size and SHA-256. Source keys, configuration context and existing object metadata
are frozen while reading S3. No public bucket or presigned URL is necessary.
The upload has a durable sending record before dispatch; timeout/invalid response
is unknown, not a reason to resend. File bytes and credentials are never persisted
in receipts. New remote test objects/uploads require the approved test scope.

Development, builds and acceptance run on remote Windows. This batch does not
merge mainlines, deploy the Worker, publish a release or submit the Chrome store.

## Remote account acceptance (2026-11-06)

- IOP product lookup and sales/purchase order lists succeeded using isolated IOP credentials.
- Warehouse lookup returned code 0 with an empty response object, not a documented empty list.
- GGS warehouses returned 403; basic freight returned 4015; sales tracking returned 408.
  These are retained as permission/platform errors, without TOP fallback or retry.
- Purchase tracking omitted the documented tracking list. It remains unavailable, not “no events”.
- Advanced freight was not sent without a legitimate company/SKU context.
- One 2,635-byte project-owned PNG was downloaded from the approved test prefix, hashed,
  durably recorded and uploaded once. Native code 0 and a safe attachment filepath were returned.
  This verifies acceptance only: there is no documented attachment content-readback endpoint,
  and no order association, order mutation or payment was performed.
- Exact 5 MB and 5 MB + 1 boundaries are checked offline. The live upload does not prove
  every account has the permission or that every supported file type is accepted.
- An exact 5,000,000-byte benign test file was also uploaded once to the private S3
  test prefix and downloaded. Both length and SHA-256 matched; the test object was retained.

Node/Worker operators enable this accepted upload separately with
`method:/alibaba/order/attachment/upload` in `ONE_VEGETABLE_MUTATION_FLAGS`.
Keep the emergency pause and administrator/CSRF checks enabled. Migration 0019 is required;
the generic API debugger cannot invoke this mutation. The extension exposes only the
same administrator-confirmed, context-bound upload, not a generic mutation bypass.
