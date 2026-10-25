# Development prerequisites

## Remote development

Follow .codex/REMOTE-DEVELOPMENT.md. Project editing, builds, tests and Alibaba
browser acceptance run in the remote development environment, not the retired
local checkout. Keep credentials and raw account acceptance data out of Git.

## Mandatory TOP / IOP preflight for every new feature

Before implementation, identify every Alibaba-dependent sub-capability and
record a protocol coverage matrix in the feature plan or development notes:

- The TOP method and IOP public path, or an explicit unsupported / not-applicable
  result. Local-only functionality must not require Alibaba authorization.
- Protocol-specific parameters, identifiers, pagination and business limitations.
- Read versus mutation risk; runtime availability and any required permissions.
- Evidence status separately: documented, adapted, account permission confirmed,
  accepted, and verified by readback. A granted permission is not proof that a
  complete workflow works.

Inspect the shared method registry, capability contracts and protocol routing
before adding adapters or business UI. For new or uncertain APIs, verify current
official documentation; descriptions alone are not sufficient evidence. Do not
infer an IOP path or reuse a TOP parameter, token, signature or success predicate.

Before dispatch, select using the **actual operation and payload**. Availability,
request context, cache identity, mutation receipts and result verification must
use that selection. Never borrow a photo-upload context for unrelated operations
or pin a future request using empty placeholder parameters.

For multi-step flows, check all dependencies and identify any TOP-only or
IOP-only step before the user starts. Explain unsupported capabilities or missing
authorization explicitly. Do not silently discard parameters, scan an entire
store, fall back to Mock, or retry a failed request through the other protocol.
An in-progress task must not silently switch credential configurations.

Acceptance must cover TOP only, IOP only, dual authorization with TOP default,
dual authorization with IOP default, and legacy unmarked TOP credentials where
applicable. Include actual page-to-gateway dispatch and configuration changes,
not only isolated adapter tests. Record the protocol used in acceptance receipts.

Real writes still require the user's scoped authorization, existing per-method
guards, persistence before sending and readback. Unknown results must not be
resent. Do not broaden write capabilities to make an acceptance test pass.
