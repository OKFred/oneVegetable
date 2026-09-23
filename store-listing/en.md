# oneVegetable

oneVegetable is a local operations workspace for Alibaba.com international sellers. It brings products, image and video assets, inventory, RFQs, trade, logistics and audited Open Platform capabilities into one Manifest V3 extension.

oneVegetable is an independently developed third-party tool and is not affiliated with, endorsed by, sponsored by, or officially associated with Alibaba.com or its affiliates. Before use, read and follow the Alibaba.com platform rules and any rules applicable to your business.

Key features:

- Visually edit Schema-based products and standard descriptions, choosing category-supported direct-order or inquiry/custom types when creating a product.
- Search, show, hide and reorder optional columns in supported lists, with fixed selection/action columns and consistent search, filter and row-action controls. Filters apply only on confirmation; repeating the same search queries again.
- Read product/SKU inventory in a dedicated workspace or shared drawer, with current-page, selected-row and individual queries, progress and a stop control. Empty or unqueried records are not zero stock, quantities are not summed across sources, and inventory is never modified.
- Inspect showcase quota and products, then confirm additions, removals, reordering or replacement and verify by read-back. Uncertain writes are never automatically retried; removing a showcase entry does not delete the product.
- Import and export products as JSON or ZIP archives with managed `assets` image resources.
- Select gallery assets and receive non-blocking content guidance.
- Browse paginated images and videos under Assets with full-screen previews. Images support 24/48/96-item pages; video relations load on demand, and platform review and quality remain distinct.
- Confirm uploads of local MP4 files up to 50 MiB through multipart staging in your configured S3 storage, or supply a public HTTPS video URL. Real upload and readback passed for the formal extension and local Node backend; Worker real uploads remain disabled. Resume manually with the task and original file or same URL. Unknown writes are never automatically resent; acceptance is not confirmed readback, and completed S3 objects and platform videos are not automatically deleted.
- Select and preview existing videos in the product editor and verify relations with read-only requests. Real relation writes remain disabled; selecting a video never automatically changes a product.
- Import and export gallery ZIPs up to 50 MiB with originals and an integrity manifest; uploads require confirmation. Connect directly to S3-compatible storage and map prefixes to gallery groups without deploying a backend.
- Pause, verify and resume ZIP/S3 tasks from local transfer history. Transfers continue across dialogs and workbench navigation, but require manual confirmation after reload. Confirmed items are not resent and uncertain results are not presented as complete success.
- Share one gallery asset through the operating system, export a sharing package, or publish it through the user's own backend to a connected Facebook Page or Instagram professional account.
- Search RFQs and edit quotations in the current page. New product/RFQ edits are not automatically persisted or restored; leaving a changed form requires confirmation. Legacy edit drafts are not read, restored, migrated or automatically deleted. Platform drafts, batch queues and durable tasks remain available.
- Combine order funding, logistics and fulfillment information.
- Search audited and typed Open Platform capabilities, including 35 additional request/response contracts, examples and permission/prerequisite details. Integration does not grant account access; restricted APIs and disabled writes remain unavailable.
- Inventory, product, gallery and video checks explain delayed platform updates. An acknowledged request may still read back old values; uncertain results require verification, not automatic resubmission or a promised synchronization time.
- Follow a four-step visual journey through developer registration, platform review, application setup, and OAuth, with in-page guidance that does not read submitted registration details.
- Reuse the current Alibaba sign-in to obtain credentials from an existing application.
- Dismiss the startup vault-unlock prompt, and inspect or clear local data, session diagnostics, guarded product-mutation and video-upload tasks, social-backend device authorization and optional host grants.

The extension runs no advertising or analytics service. The credential assistant accesses only the known Alibaba Application Center and OAuth tabs after the user starts it, and it neither collects the website password nor bypasses human verification. Credentials are encrypted on the user's device with a user passphrase; extension content scripts cannot access storage and the passphrase is not stored. Unlock material is retained only in current Chrome-session memory so page refreshes and MV3 worker dormancy do not require another prompt; it is cleared by browser restart, extension update/reload, explicit locking, or the selected idle timeout. Requests are sent only after a user action: guarded platform drafts, new-product publishing, product-content updates, product listing/unlisting, product-group creation, gallery group management, image upload, and external-image transfer are enabled after real-account validation, while unverified Alibaba write operations are blocked before network access. Product-content and display changes record a minimal local task before sending, then read Schema or the product list back to verify the final state; listing/unlisting also supports explicit recovery to the original state.

Official social publishing requires the user's own oneVegetable backend and Meta application. The extension requests access only to that exact backend when the user starts pairing and stores a revocable, scoped 30-day device token; it does not store a Meta App Secret or platform token. An image is sent through the user's backend to Meta only after the user selects one image, a destination and a caption and confirms again.

Video uploads use a separate guarded task workflow, not generic debugger writes or product-video association. Tasks retain titles, filenames and fingerprints, multipart metadata and receipts, not file bytes, Base64, source or signed URLs, or credentials. Submission sends the video address to Alibaba for retrieval. Video staging reuses your authorized S3 host and adds no extension permission.
