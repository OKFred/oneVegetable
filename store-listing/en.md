# oneVegetable

oneVegetable is a local operations workspace for Alibaba.com international sellers. It brings product, gallery, RFQ, trade, logistics and audited Open Platform capabilities into one Manifest V3 extension.

Key features:

- Visually edit Schema-based products and standard descriptions.
- Select gallery assets and receive non-blocking content guidance.
- Search RFQs and keep quotation drafts locally.
- Combine order funding, logistics and fulfillment information.
- Search audited and typed Open Platform capabilities.
- Inspect and clear local data, session diagnostics and optional host grants.

The extension runs no advertising or analytics service. Credentials are encrypted on the user's device with a user passphrase; extension content scripts cannot access storage, the passphrase is not stored, and only an unlocked service worker decrypts credentials for request signing. The vault locks after the configured idle period. Requests are sent only after a user action: gallery group management, image upload, and external-image transfer are enabled, while other write operations are blocked before network access.
