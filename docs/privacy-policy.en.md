# oneVegetable Privacy Policy

Effective date: August 13, 2026  
Applicable version: 2.0.1

## Single purpose

oneVegetable is a user-operated local Alibaba.com operations workspace for managing products, the gallery (Photo Bank), RFQs, trades, international logistics, and related Open Platform capabilities. The extension does not provide advertising, tracking, or data services unrelated to this purpose.

## Data processed

- App Key, App Secret, Access Token, signature algorithm, and gateway address entered by the user;
- product Schema drafts and RFQ quotation drafts created by the user;
- product, gallery, RFQ, trade, logistics, and data insight responses requested from the user's Alibaba.com Open Platform account;
- up to 100 recent session-scoped redacted diagnostics containing operation names, durations, error codes, and available traceIds.

Credentials and settings are encrypted in `chrome.storage.local` with an AES-256-GCM key derived from the user's passphrase using PBKDF2-HMAC-SHA256 with 600,000 iterations. The passphrase is not stored. The key exists only in the unlocked service worker memory, and the vault automatically locks after a service worker restart. Drafts are stored in the extension's own `localStorage`. Redacted diagnostics are stored in `chrome.storage.session` and are not retained as long-term logs after the browser session ends. The extension runs no first-party analytics or advertising service and does not send this data to a developer-operated server.

Both `chrome.storage.local` and `chrome.storage.session` use Chrome `TRUSTED_CONTEXTS`; web pages and extension content scripts cannot read them through the Storage API. By default, the vault automatically locks after credentials have not been used for 15 consecutive minutes. The user may select 5, 15, 30, or 60 minutes. Status checks do not extend the timer; only an actual credential read or update does. If the service worker terminates sooner, the in-memory key is lost immediately.

A forgotten vault passphrase cannot be recovered. The user must erase all extension-local data and configure the credentials again. Legacy plaintext credentials are never used for real requests. After the user creates a new passphrase, the service worker performs the encryption migration in place without returning the old App Secret or Access Token to a page.

## Data use and transfer

Real queries are sent only after a user action. The extension service worker sends them over HTTPS to the Alibaba.com Open Platform gateway configured by the user. An external image is downloaded from the specified public HTTP(S) URL and uploaded to the user's own international gallery only after the user explicitly starts that transfer.

Use of user data follows the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide or improve the disclosed single purpose and is not used for personalized advertising, credit assessment, or data resale. The developer does not permit a person to read user data unless the user explicitly authorizes technical support, a security investigation requires it, or the law requires it.

## Permissions

- `storage`: stores local credentials, settings, onboarding state, and session diagnostics;
- `https://eco.taobao.com/*`: calls the official Alibaba.com HTTPS Open Platform gateway;
- optional `http://*/*` and `https://*/*`: Chrome access is requested for a specific host only when the user configures a custom gateway or explicitly transfers an external image. The user can revoke each grant in Settings.

The extension does not request cookies, browsing history, tabs, or a required `<all_urls>` permission. Gallery group management, image upload, and external image transfer occur only after an explicit user action. Other real write operations remain blocked before any network request leaves the extension background.

## Data control and retention

Settings lets the user lock the vault, change the passphrase, inspect and export an inventory that contains no secret values, clear session diagnostics, revoke extra host permissions, and permanently erase credentials, settings, drafts, and diagnostics. Uninstalling the extension also removes extension-local storage managed by Chrome.

## Security and limitations

Extension pages use a Manifest V3 CSP and do not execute remote code. App Secret is decrypted and used for signing only by the extension service worker. Local encryption reduces static-storage exposure but cannot protect an unlocked runtime, a browser controlled by malware, or the user's compromised device. Higher-security deployments should use a BFF controlled by the user. Alibaba.com determines platform permissions, business qualifications, and current API availability. The extension does not fabricate successful results when access is unavailable.

## Contact and changes

Project homepage and issue tracker: [github.com/OKFred/oneVegetable](https://github.com/OKFred/oneVegetable). If data practices change materially, the extension will update its prominent disclosure and obtain user consent before processing newly disclosed data.
