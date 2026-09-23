# Node URL-mode real acceptance

Windows working directory: `D:/workspace/okfred/oneVegetable`. Main owns live execution. This harness does not build, alter configuration, upload/delete S3 objects, or change feature flags. **Submit does upload one video to Alibaba.**

Default invocation / `--preflight` prints only the pinned source plan; no credentials are read and no calls are made. Live submission requires both opt-ins, an explicit new UUID v4, and the exact approved key:

```powershell
$env:ONE_VEGETABLE_VIDEO_UPLOAD_URL_REAL_SMOKE = '1'
$env:ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE = '1'
$urlSmokeRun = [guid]::NewGuid().ToString()
pnpm exec tsx scripts/smoke-video-upload-url-real.ts --submit "--run=$urlSmokeRun" --source-key=onevegetable/video-staging/d6ae6b47-01c7-4f94-b52a-393a250df7ec/source.mp4
```

This first signs a fresh GET URL for exactly `https://oss-s3.this-time.com/dev/onevegetable/video-staging/d6ae6b47-01c7-4f94-b52a-393a250df7ec/source.mp4`, using the existing encrypted S3 credentials in memory. Public endpoint selection happens **before signing**; no post-sign host replacement occurs. No saved URL input is accepted.

Exactly three anonymous signed range GETs must return 206 with the correct range totals/lengths and MP4 header. They verify all **7,203,235 bytes** against SHA-256 **b84712f8a3e50f92f87bd3738ccc2456db2cea287eebed5b0526357523c6a2f6** before BFF login or task creation. No cookies, Authorization header, redirects, or retries are used for these GETs. A failed public GET stops here; it never falls back to a private URL or multipart upload.

Afterward the script uses normal local admin login, cookies, CSRF, runtime/storage/context checks, and the existing upload feature gate. Create and submit use the **identical ephemeral URL** back-to-back; the task's URL fingerprint must match. Accepted is not confirmed: submission exits **2**, with a task ID for separate readback.

Defaults:

- BFF: `http://127.0.0.1:8798`; only this origin or `http://localhost:8798` is accepted by `VIDEO_SMOKE_BFF_URL`.
- Auth: `artifacts/video-upload-validation/isolated/2026-09-23T04-26-42-359Z-12d00d9b/local-auth.json`.
- Read-only S3 DB: the same directory's `isolated.sqlite`.
- Override auth via `VIDEO_SMOKE_LOGIN_FILE`; encrypted source DB via `ONE_VEGETABLE_S3_SMOKE_DATABASE` (for example `artifacts/s3-live-validation/ui.sqlite`). Both must remain gitignored workspace paths. The DB is never migrated/written. `.env` is parsed only for the existing encryption key, never for opt-ins.

Readback is a separate, remote-read-only step. It needs only the URL live opt-in and the same run plus returned **URL task** ID:

```powershell
# Set $urlSmokeTask to the returned URL task ID; not the original S3 staging task ID.
pnpm exec tsx scripts/smoke-video-upload-url-real.ts --verify "--run=$urlSmokeRun" "--task=$urlSmokeTask"
```

Verify performs one platform lookup, never signs another URL or resubmits. Exit 0 means confirmed readback; 2 means pending; 1 means stopped. Main's existing `smoke-video-upload-task-real.ts --verify --task=...` can also read back using this same BFF/auth.

`artifacts/video-upload-url-validation/<runId>/journal.json` records intent **before every network call**, with fixed phases, UUIDs and outcomes. Failed BFF calls additionally record `diagnostic: { code, httpStatus }`. Codes use an exact, finite project-code allowlist (including `VIDEO_RESPONSE_INVALID` and `VIDEO_BASELINE_INCOMPLETE`); unknown codes become `BFF_CALL_REJECTED_NO_RETRY`. HTTP status survives bounded non-JSON responses, but transport failures without a response have no HTTP status. Provider messages, subCodes and signed URLs are never retained. Old journals without diagnostics remain readable; old generic errors cannot be reconstructed retroactively.

The directory remains permanently single-use for submission, including failed reads or lost replies. Do not delete it to retry. An active lock is not automatically removed after process death. Reports never contain credentials, cookies, full provider responses or raw exceptions. Local login/session and task receipts may change during verification; no provider mutation is requested.

Failure `reason`/terminal output now retains only exact allowlisted filesystem errnos (for example `EPERM`, `EACCES`, `EBUSY`, `ENOSPC`, `EIO`) and known project network/guard codes; no exception messages or paths. The shared script JSON writer retries **only the same temp-to-target rename** on Windows `EPERM`/`EACCES`/`EBUSY`, at 50/100/200/400 ms (five attempts total). Permanent/exhausted failures preserve the old target and attempt cleanup of only the exclusively created temp; cleanup failure preserves the original error and may leave that temp. Network calls and mutations are never retried.

Read-only diagnostic API (no new CLI flag): `UrlAcceptanceRun.diagnoseBaseline({ credentials, bff }, taskId)`. Use the existing journal/persistence callback and `urlNetworkIo(base).bff`, with the normal in-memory login credential loader. It requires the exact journal task ID, reads its stored title through `video.get`, and requests only `listVideos` at page 1/pageSize 20 through `/operations/call` with that exact title and gallery context. It returns only `{ count, page, total, code }`; HTTP error status remains in the safe call receipt. Count means returned page length; `total: null` remains unknown. Incomplete totals get `VIDEO_BASELINE_INCOMPLETE`. It never signs, ranges, creates, submits, retries or marks platform acceptance. A stopped task can be diagnosed without claiming an Alibaba submission occurred.

Only offline tests/type/lint checks are part of harness development. Successful public GETs and Alibaba acceptance remain unverified until main runs the explicit live command.
