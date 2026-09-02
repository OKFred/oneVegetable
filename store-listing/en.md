# oneVegetable

oneVegetable is a local operations workspace for Alibaba.com international sellers. It brings product, gallery, RFQ, trade, logistics and audited Open Platform capabilities into one Manifest V3 extension.

Key features:

- Visually edit Schema-based products and standard descriptions.
- Import and export products as JSON or ZIP archives with managed `assets` image resources.
- Select gallery assets and receive non-blocking content guidance.
- Share one gallery asset through the operating system, export a sharing package, or publish it through the user's own backend to a connected Facebook Page or Instagram professional account.
- Search RFQs and keep quotation drafts locally.
- Combine order funding, logistics and fulfillment information.
- Search audited and typed Open Platform capabilities.
- Reuse the current Alibaba sign-in to obtain credentials from an existing application.
- Inspect and clear local data, session diagnostics, guarded product-display tasks, social-backend device authorization and optional host grants.

The extension runs no advertising or analytics service. The credential assistant accesses only the known Alibaba Application Center and OAuth tabs after the user starts it, and it neither collects the website password nor bypasses human verification. Credentials are encrypted on the user's device with a user passphrase; extension content scripts cannot access storage and the passphrase is not stored. Unlock material is retained only in current Chrome-session memory so page refreshes and MV3 worker dormancy do not require another prompt; it is cleared by browser restart, extension update/reload, explicit locking, or the selected idle timeout. Requests are sent only after a user action: guarded product listing/unlisting, gallery group management, image upload, and external-image transfer are enabled, while other Alibaba write operations are blocked before network access. Product listing/unlisting records a minimal local task before sending, then reads the product list back to verify the final state and supports explicit recovery to the original state.

Official social publishing requires the user's own oneVegetable backend and Meta application. The extension requests access only to that exact backend when the user starts pairing and stores a revocable, scoped 30-day device token; it does not store a Meta App Secret or platform token. An image is sent through the user's backend to Meta only after the user selects one image, a destination and a caption and confirms again.
