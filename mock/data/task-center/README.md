# Task-center raw fixture

`snapshot.json` contains source records, not `TaskSummary` objects. `summaries.json` is owned by the UI workstream and is not generated from this file.

| Field                | Shape / seed target                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context`            | `GalleryTransferContext`; align this with the gateway used by the test.                                                                                    |
| `productPage`        | `ProductMutationJobPage`; return from the product list adapter.                                                                                            |
| `gallery`            | `GalleryTransferTaskV1[]`; validate and pass each record to `IndexedDbGalleryTaskRepository.create()`.                                                     |
| `videoUploads`       | AJV-valid `VideoUploadResult`; return from the existing video control `list` command.                                                                      |
| `associationReceipt` | Persisted v1 receipt, deliberately still `sending`; serialize to the scoped localStorage key below.                                                        |
| `queue`              | Minimal legacy queue identity/link hints; serialize to `one-vegetable-product-batch-publish-v2` for task-center-only tests. These are not executor inputs. |

Association key:

```ts
VIDEO_ASSOCIATION_PREFIX +
  JSON.stringify([mode, JSON.stringify([context.identity, context.gateway]), receipt.request.productId]);
```

The fixture's `task-actor` / `task-gateway` / `task-storage` context is synthetic. When seeding a running mock app, replace gallery/video contexts with that app's actual `gateway.galleryTransferContext()` result and construct the association key with the same identity/gateway. There is no anonymous or mock-context fallback in the loader.

## Read boundaries

- Product list reads exactly one explicit page of 100, with `productHasMore = productPage * 100 < total`. Product records have no Alibaba account fingerprint: `accountMatch` stays `unknown`, including when a batch hint links to a workbench-visible job. That link is not proof of current Alibaba account ownership.
- Video `list` returns at most 100 recent records. This is not a complete historical archive and has no automatic paging, verification or recovery.
- Gallery and video records from another identity are omitted. A gateway change is `accountMatch: changed`; a storage-only change sets `contextChanged` without changing account ownership.
- The gallery repository retains its existing local retention/quarantine policy inside `list()`. The task-center loader adds no cleanup. Invalid records that a repository actually returns produce source warnings. The existing repository does not expose records it already quarantines.
- Association and batch localStorage reads never migrate, delete, recover or rewrite values. An unresolved `sending` receipt stays persisted as `sending` and is displayed as `attention`.
- Fixtures include deliberately private-looking source fields to test that only summary allowlisted fields are returned. Never seed them into live provider accounts.

`task-center.test.ts` verifies the raw gallery fixture with the real repository and fake IndexedDB, as well as source isolation, context races, paging, receipt validation and sensitive-field exclusion.
