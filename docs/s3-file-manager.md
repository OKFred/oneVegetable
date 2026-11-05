# S3 file manager implementation

## Scope and sequence

1. VueFinder proof-of-integration and measured bundle cost.
2. Shared S3 directory listing, opaque storage context and create-only writes.
3. Lazy `#/files` workspace: folder navigation, grid/list, current-directory
   search, explicit pagination, upload/download, safe preview and new directory.
4. Remote regression, readback acceptance, documentation and development push.
5. Separate follow-up: copy, move, rename, confirmed file deletion, then asset,
   template and inventory-snapshot pickers. No recursive deletion, in-place
   editing, automatic sync or new deployment in this batch.

Reuse the configured private bucket and root prefix. No PHP/backend deployment,
public bucket, browser-held S3 secret or additional permanent extension permission.
VueFinder is an MIT-licensed frontend; its custom Driver calls the existing
trusted BFF or extension service worker, never a third-party server.

## TOP / IOP preflight

| Capability                   | TOP                                 | IOP                                 | Runtime and risk                                                      |
| ---------------------------- | ----------------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Browse, preview, download    | not applicable                      | not applicable                      | S3 ListObjectsV2/GetObject; administrator/trusted extension page.     |
| Upload and new directory     | not applicable                      | not applicable                      | S3 PutObject with If-None-Match: *; explicit confirmation, no retry.  |
| Asset import/export          | existing operation-specific routing | existing operation-specific routing | Follow-up reuses accepted transfer tasks; no borrowed upload context. |
| Template / inventory backups | not applicable                      | not applicable                      | Follow-up local data + S3; no Alibaba authorization requirement.      |

Documented support, adapted code, account permission and successful readback are
tracked separately. This feature must work with no Alibaba credential configured.

## Boundaries

- Listing uses delimiter `/`, CommonPrefixes and opaque continuation tokens;
  do not recursively scan the bucket, fabricate totals or search unseen pages.
- Bind requests to an opaque S3 configuration context, independent of Alibaba.
  Changing configuration stops old operations and discards late responses.
- Create-only uploads: refuse collisions, never silently overwrite. No automatic
  retry on PUT timeout. Verify new bytes by GET before reporting confirmed success.
- Initially preserve the existing 5 MiB object limit, including previews/downloads.
  Larger objects remain visible with an explicit limit; generic multipart support
  is a separate change, not a global relaxation of image/ZIP limits.
- A folder is an S3 key prefix. Empty folders use zero-byte trailing-slash marker
  objects, with create-only semantics. Never normalize an object into another key.
- Preview only bounded images, media and escaped text; do not execute HTML/SVG,
  open arbitrary object URLs or expose a permanent public/signed link.
- UI follows application language/theme; no business query on language change.
- Keep all work in remote Windows. Preserve the unfinished inventory snapshot
  worktree separately and do not merge, deploy or release either feature here.

## Checks

### Cloudflare R2

The same file manager and signed S3 client support R2; there is no additional
VueFinder adapter, AWS SDK, Worker binding or deployment. In S3 settings use the
dashboard's S3 API endpoint (account-id.r2.cloudflarestorage.com), your private
bucket, Region auto, path-style addressing, and R2 S3 Access Key ID/Secret Access
Key. A Cloudflare account API token or a public r2.dev/custom domain is not a
replacement for those S3 credentials and endpoint. Keep the bucket private.

R2 ListObjectsV2 supports delimiter, prefix and opaque continuation tokens.
PutObject supports atomic If-None-Match: * and returns 412 for a collision, matching
the manager's create-only policy. We do not send unsupported ACL or bucket-owner
headers. Configuration/context protection and the 5 MiB limit are unchanged.
Synthetic R2 signing/response tests are not a live R2 account acceptance result;
the current live provider acceptance is RustFS. No R2 resources are created here.

Reference: https://developers.cloudflare.com/r2/api/s3/api/

### Regression

Contracts/generated types/validators; S3 signature, directory pagination, root
escape, malformed XML, collision, configuration change and no-retry tests;
BFF admin/CSRF and trusted sender tests; Web/MV3 bilingual, dark and narrow E2E.
Measure final ZIP/unpacked budgets. The user approved a modest size increase on
2026-11-05: keep ZIP at 2,000,000 bytes and raise only unpacked to 7,000,000 bytes.
All startup/chunk/security gates remain unchanged. Real S3 acceptance uses
a unique test prefix, no Alibaba writes, and no changes to existing keys, bucket
policies or objects. The user separately approved a seven-day credential restricted
to listing and reading/writing dev/onevegetable/file-manager-test/, without
deletion permission. Private credentials and receipts remain in ignored artifacts.
Provider failures never fall back to mock data.

References: https://vuefinder.ozdemir.be/guide/drivers-adapters.html and
https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html .

## Remote acceptance, 2026-11-05

- Windows full unit regression passed 413 files / 5,370 tests, including the three
  R2 cases; the targeted R2/file-manager suite passed 52 tests.
- Workerd passed 32 tests, including D1 configuration pinning and signed empty
  folder PUT/GetObject/conditional conflict handling. Worker dry-run passed.
- Real VueFinder browser tests passed all five cases, including actual grid/list
  DOM switching, opaque pagination, confirmation, byte readback, collision,
  escaped HTML, Chinese/English and a 390px dark layout.
- The formal MV3 encrypted configuration/restart/trusted-sender test passed,
  including opening the unconfigured file workspace without Alibaba credentials.
  Initial S3 file I/O was checked through the shared client and isolated Node BFF
  UI; configured live-workspace acceptance is recorded below.
- RustFS acceptance used 18 signed requests across the shared client and Web UI.
  Four new test objects were retained under a unique test directory: two empty
  directory markers and two text files. All writes were followed by byte readback;
  a conditional duplicate PUT was rejected and original bytes were unchanged.
  Existing bucket policies, credentials and objects were not changed or deleted.
- R2 acceptance is document-backed signing/response regression, not a live R2
  account test. Initial development did not replace published ZIPs or deploy;
  mainline integration and website deployment were subsequently authorized.

## Configured live-workspace acceptance, 2026-11-05

- The existing Cloudflare website and formal unpacked MV3 workspace were configured
  with the approved seven-day test credential, restricted to the test prefix.
- Both runtimes listed the same directory, created one uniquely named 2,635-byte
  PNG, visibly previewed it, and downloaded it through the actual browser. Provider
  readback and both downloads matched the original SHA-256. No objects were deleted,
  overwritten or moved; bucket policies were unchanged.
- Extension refresh exposed an idle startup identity-hydration warning. Idle
  reconnects are now silent; actual interrupted operations still stop. Unknown-write
  warnings survive later hydration, and late writes are never replayed or reported
  as successful.
- Private receipts remain in ignored artifacts. R2 live acceptance is still not
  claimed. Replace the test credential when its seven-day term ends.
