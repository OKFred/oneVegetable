# One-shot S3 → IOP order attachment acceptance

This driver is isolated acceptance tooling, not a production upload bypass.
It does not change the registry, production flags, credentials, saved S3 configuration,
orders, products or inventory. Importing the module sends nothing.

## Fixed scope and evidence boundary

| Capability              | TOP                      | IOP / S3 scope                                 | Evidence produced                                    |
| ----------------------- | ------------------------ | ---------------------------------------------- | ---------------------------------------------------- |
| Source read             | Not applicable           | One GET of the fixed dev object                | Exact source byte length, PNG validation and SHA-256 |
| Attachment write        | Unsupported here         | One POST to `/alibaba/order/attachment/upload` | Native code 0 plus a nonempty safe filepath          |
| Order association       | Not performed            | No order ID or order write                     | None                                                 |
| Target content readback | Not provided by platform | No readback endpoint is inferred               | None                                                 |

Success means **accepted but not order association/content-readback**.
Verifying the S3 source hash is not verification of the uploaded platform copy.

Only this existing nonbusiness leaf-icon source is allowed:

- Endpoint: `https://oss-s3.this-time.com`
- Bucket: `dev`
- Root prefix: `onevegetable/file-manager-test`
- Relative key: `extension-check-20261105-5a0d2af8.png`
- Bytes: `2635`
- SHA-256: `55e5de235bdeda85d13a056fca171ba9d332ac756c57b27e56cee9706623f3ed`

Configuration must be path-style HTTPS. Missing `pathStyle` defaults to `true`;
missing `sessionToken` defaults to `null`. A session token, another endpoint,
bucket, prefix, source key or virtual-host addressing is refused.
No listing, HEAD, PUT, deletion or presigned URL is used.

## Review and offline checks

Run only on the remote development host and this worktree:

```powershell
Set-Location D:/workspace/okfred/oneVegetable-s3-file-manager
pnpm exec vitest run scripts/test/order-attachment-real.test.ts
pnpm exec tsc --noEmit -p scripts/test/tsconfig.order-attachment-real.json
pnpm exec eslint scripts/smoke-order-attachment-real.ts scripts/test/order-attachment-real.test.ts
```

Tests use the repository icon, synthetic credentials, mocked network responses and
fresh private temporary receipt databases. A test-level fetch trap rejects any
accidental real network use. They never read the real private credential/config files.

## Explicit single real invocation — reviewer only

Do not run until the main reviewer approves. Replace `<NEW_UUID>` once with a new UUID.
Do not regenerate a directory and run again after an unknown result or interruption.

```powershell
Set-Location D:/workspace/okfred/oneVegetable-s3-file-manager
$receiptDir = 'artifacts/order-attachment-20261106-<NEW_UUID>'
pnpm exec tsx scripts/smoke-order-attachment-real.ts `
  --confirm-test-attachment `
  --credential=D:/workspace/okfred/oneVegetable/artifacts/local-dual-authorization/iop-credentials.json `
  --s3-config=D:/workspace/okfred/oneVegetable-s3-file-manager/artifacts/s3-file-manager/s3-test.private.json `
  --source-key=extension-check-20261105-5a0d2af8.png `
  "--receipt-dir=$receiptDir"
```

All five options are mandatory. Both private input paths are pinned; no environment,
default credential profile, browser cookie, refresh, TOP fallback or token endpoint
is used. IOP must be explicit and expiry must be known with at least a two-minute
preflight margin. The required IOP access token is used only in the signed multipart
body; token issuance/refresh requests are forbidden.

The artifacts parent must be a real directory, not a symlink/junction.
Receipt directory creation is exclusive and non-recursive. Even a previous preflight
failure consumes that directory: reusing it is refused before reading private inputs.

## Durability, outputs and failures

- A new `receipts.sqlite` is opened only after exclusive file creation. Only a fresh
  `schema_migrations` table and migration `0019_order_attachment_jobs.sql` are initialized.
  Existing application databases and migration loaders are not used.
- SQLite runs with `synchronous=FULL`. The normal repository/service commits
  `sending` before dispatch. The guarded native transport independently rereads and
  verifies that receipt before allowing the one exact upload URL.
- Both source and upload have a hard one-request budget and `maxAttempts: 1`.
  Cookies are omitted, redirects are manual-and-denied, and other URLs/methods fail closed.
- Windows creates a private directory ACL for the current user, SYSTEM and Administrators;
  POSIX uses directory mode 0700 and files 0600. Sidecar SQLite files remain inside it.
- Stdout contains only status, bytes, SHA-256, request ID, trace ID and optional reference hash.
  `report.json` contains those summaries and the explicit acceptance limitations.
  `provider-rejection.json`, when present, contains sanitized codes, trace ID and HTTP status,
  never the provider message, response body, signed URL or credentials.
- The private SQLite record may retain the validated safe filepath. Neither public report
  contains it; file bytes/Base64, private configuration and raw responses are never stored.
- Permission rejection, invalid success, transport error or timeout remains `unknown`
  after the possible send; a sanitized provider code is diagnostic evidence, not proof of
  non-execution. There is no retry/resume mode and no automatic re-send.
- Non-accepted runs exit nonzero. Keep every artifact after an interruption. Inspect the
  existing SQLite/report read-only; do not delete the claim or choose another directory
  to retry an uncertain write.
