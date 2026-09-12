# oneVegetable

oneVegetable is a local operations workspace for Alibaba.com international sellers. It brings product, gallery, RFQ, trade, logistics and audited Open Platform capabilities into one Manifest V3 extension.

oneVegetable is an independently developed third-party tool and is not affiliated with, endorsed by, sponsored by, or officially associated with Alibaba.com or its affiliates. Before use, read and follow the Alibaba.com platform rules and any rules applicable to your business.

Key features:

- Visually edit Schema-based products and standard descriptions, choosing category-supported direct-order or inquiry/custom types when creating a product.
- Customize product, gallery and order columns, load extra fields on demand, and open platform product links with dedicated buttons.
- Inspect showcase quota and products, then confirm additions, removals, reordering or replacement and verify by read-back. Uncertain writes are never automatically retried; removing a showcase entry does not delete the product.
- Import and export products as JSON or ZIP archives with managed `assets` image resources.
- Select gallery assets and receive non-blocking content guidance.
- Import and export gallery ZIPs up to 50 MiB with originals and an integrity manifest; uploads require confirmation. Connect directly to S3-compatible storage and map prefixes to gallery groups without deploying a backend.
- Pause, verify and resume ZIP/S3 tasks from local transfer history. Transfers continue across dialogs and workbench navigation, but require manual confirmation after reload. Confirmed items are not resent and uncertain results are not presented as complete success.
- Share one gallery asset through the operating system, export a sharing package, or publish it through the user's own backend to a connected Facebook Page or Instagram professional account.
- Search RFQs and keep quotation drafts locally.
- Combine order funding, logistics and fulfillment information.
- Search audited and typed Open Platform capabilities.
- Follow a four-step visual journey through developer registration, platform review, application setup, and OAuth, with in-page guidance that does not read submitted registration details.
- Reuse the current Alibaba sign-in to obtain credentials from an existing application.
- Inspect and clear local data, session diagnostics, guarded product-mutation tasks, social-backend device authorization and optional host grants.

The extension runs no advertising or analytics service. The credential assistant accesses only the known Alibaba Application Center and OAuth tabs after the user starts it, and it neither collects the website password nor bypasses human verification. Credentials are encrypted on the user's device with a user passphrase; extension content scripts cannot access storage and the passphrase is not stored. Unlock material is retained only in current Chrome-session memory so page refreshes and MV3 worker dormancy do not require another prompt; it is cleared by browser restart, extension update/reload, explicit locking, or the selected idle timeout. Requests are sent only after a user action: guarded platform drafts, new-product publishing, product-content updates, product listing/unlisting, product-group creation, gallery group management, image upload, and external-image transfer are enabled after real-account validation, while unverified Alibaba write operations are blocked before network access. Product-content and display changes record a minimal local task before sending, then read Schema or the product list back to verify the final state; listing/unlisting also supports explicit recovery to the original state.

Official social publishing requires the user's own oneVegetable backend and Meta application. The extension requests access only to that exact backend when the user starts pairing and stores a revocable, scoped 30-day device token; it does not store a Meta App Secret or platform token. An image is sent through the user's backend to Meta only after the user selects one image, a destination and a caption and confirms again.
