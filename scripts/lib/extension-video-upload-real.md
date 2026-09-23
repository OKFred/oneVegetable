# Formal extension video acceptance (Windows)

Run from `D:/workspace/okfred/oneVegetable`. This harness never builds or changes runtime flags. Main must review it, finish Node acceptance and isolated extension tests, and make the fixed runtime-whitelist decision before building the formal extension. A disabled build stops stage/submit with `FORMAL_EXTENSION_UPLOAD_DISABLED`; environment opt-ins cannot override it.

The commands below are separate operator steps, **not an automatically executed acceptance sequence**.

## Read-only UI independently

```powershell
pnpm exec tsx scripts/smoke-extension-video-upload-real.ts
$env:ONE_VEGETABLE_EXTENSION_VIDEO_UPLOAD_REAL_SMOKE = '1'
$videoSmokeRun = [guid]::NewGuid().ToString()
pnpm exec tsx scripts/smoke-extension-video-upload-real.ts --ui-read "--run=$videoSmokeRun" --restart
```

The first command reads/hashes only the existing `apps/extension/.output/chrome-mv3` build; it opens no browser. The second invocation exercises real video reads, upload-task UI and worker restart without S3 setup or upload enablement. Empty video lists are valid. Neither clicks upload confirmations nor injects hooks.

## Local preparation (no S3 object or Alibaba write)

Reuse the run UUID above, or explicitly allocate a fresh UUID. The bundle defaults to ignored `artifacts/openapi-auth/credentials.json`. S3 is decrypted in memory from ignored `artifacts/s3-live-validation/ui.sqlite` using the existing environment/`.env` key or `.data/local-credential-encryption-key`. Overrides `ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE` and `ONE_VEGETABLE_S3_SMOKE_DATABASE` must still point inside the ignored workspace. No plaintext configuration input is accepted.

```powershell
$videoSmokeFile = 'artifacts/video-upload-validation/5bc87ce0-e58b-470b-80c0-9812769d6a5c/synthetic-video.mp4'
pnpm exec tsx scripts/smoke-extension-video-upload-real.ts --prepare "--run=$videoSmokeRun" "--file=$videoSmokeFile"
```

Approve the actual Chromium permission prompt for the stored S3 endpoint. The tool does not pregrant permissions, change manifests or substitute endpoints. It saves through the existing encrypted extension vault, then creates one local task. Source database configuration is never modified. Only the isolated profile's root prefix becomes empty, so task keys remain `onevegetable/video-staging/<taskId>/source.mp4` in bucket `dev`. Path-style HTTPS at exactly `oss-s3.this-time.com` or `oss-s3.app.fred.wiki` is mandatory.

Copy the **extension task ID** from the redacted result into `$videoSmokeTask`; do not reuse a Node task ID. Preserve `artifacts/extension-video-upload-validation/<runId>/` for recovery. The isolated vault passphrase is derived in memory from the existing app secret and run UUID; no separate password file is created. Credentials are persisted only by the normal encrypted extension stores. Changed source Alibaba credentials cause a context mismatch, not an automatic vault update.

## Stage, pause, restart, explicitly resume

Only after main has validated and built an enabled formal runtime:

```powershell
$env:ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE = '1'
# Set $videoSmokeTask to the exact ID returned by --prepare before proceeding.
pnpm exec tsx scripts/smoke-extension-video-upload-real.ts --stage "--run=$videoSmokeRun" "--task=$videoSmokeTask" "--file=$videoSmokeFile" --stop-after-parts=1
pnpm exec tsx scripts/smoke-extension-video-upload-real.ts --inspect "--run=$videoSmokeRun" "--task=$videoSmokeTask" --restart
pnpm exec tsx scripts/smoke-extension-video-upload-real.ts --stage "--run=$videoSmokeRun" "--task=$videoSmokeTask" "--file=$videoSmokeFile" --resume
```

Each command is a deliberate operator action. Pause is **between acknowledged parts**, not an artificial crash during a write. Restart compares worker time origins, account/storage context and complete durable task snapshots. Resume hashes the entire reselected MP4 and sends only pending parts. For uncertain requests, separately use `--reconcile --run=... --task=...` for read-only S3 reconciliation. Only authoritative part reconciliation can clear an uncertain part intent. Unknown initiation/completion results never trigger automatic retries. Completed objects are preserved.

## Submit once, read back separately

```powershell
pnpm exec tsx scripts/smoke-extension-video-upload-real.ts --submit "--run=$videoSmokeRun" "--task=$videoSmokeTask"
pnpm exec tsx scripts/smoke-extension-video-upload-real.ts --verify "--run=$videoSmokeRun" "--task=$videoSmokeTask" --restart
```

Submit requires exactly **public** `https://oss-s3.this-time.com`; private-host tasks cannot be silently retargeted. It submits once and exits 2 even if accepted: acceptance is not confirmed readback. Verify performs one read-only lookup; rerun it manually if needed. Exit 0 with `platform-readback-confirmed` is the platform readback boundary. Exit 2 means pending/unconfirmed; exit 1 means stopped. No cancellation, deletion, product association or remote cleanup exists.

## Evidence and limitations

- Reports contain fixed statuses, IDs, counts and hashes, never credentials, signed URLs, request/response bodies, provider strings, filenames, titles or ETags. No screenshot, HAR, video or trace is captured; Playwright debug logging must be unset.
- `journal.json` persists intent before each command; `active.lock` prevents concurrent runs. After process death, inspect the processes/profile before **manually** removing a stale lock. Never delete a journal to make a write retry possible. A lost local-create reply requires manual inspection; preparation will not create a duplicate.
- Secrets are decrypted in process/browser memory and saved only through the application's encrypted stores. The ignored Chromium profile is still sensitive local state: it is not an exportable report.
- Counts are **commands attempted**, not proof of HTTP traffic or committed writes. The harness does not pretend Playwright page routing intercepts extension-worker traffic.
- Real commands use the same trusted options-page protocol as the extension client. UI checks are read-only. This is not an end-to-end automated upload-dialog/confirmation UX test.
- No flag override exists. Manifest validation rejects pregranted S3 host permissions. Only the formal build is loaded and its hash recorded. Build/source/runtime acceptance remain separate evidence.

## Local checks (no browser or network)

```powershell
pnpm exec eslint scripts/smoke-extension-video-upload-real.ts scripts/lib/extension-video-upload-real.ts scripts/test/extension-video-upload-real.test.ts
pnpm exec tsc --noEmit -p scripts/test/tsconfig.extension-video-upload-real.json
pnpm exec vitest run scripts/test/extension-video-upload-real.test.ts
```
