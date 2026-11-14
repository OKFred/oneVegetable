# Packing plan reuse (2.26.0)

## Protocol preflight and scope

| Capability            | TOP            | IOP            | Runtime / data                                            |
| --------------------- | -------------- | -------------- | --------------------------------------------------------- |
| Save/open named plans | Not applicable | Not applicable | Explicit browser localStorage, no automatic restoration   |
| Import/export JSON    | Not applicable | Not applicable | Local files; validated input only; no placements accepted |
| Packing calculation   | Not applicable | Not applicable | Existing local Worker and validation, unchanged           |

No Alibaba request, backend route, database migration, dependency or extension permission is added.
Plans belong to this browser origin, not an Alibaba account; do not put secrets in names.
Save up to 20 named plans; keep dimensions in integer millimetres internally.
Imported files are versioned, limited to 64 KiB and validated before replacing input.
Replacing current input and deleting a saved plan require confirmation.
Storage corruption/quota errors must not silently overwrite existing plans.
Only explicit saved plans persist; page edits and computed results remain memory-only.
Clearing all local data also removes saved packing plans.

The original size, quantity and transport-safety limitations remain unchanged.
