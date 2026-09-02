# oneVegetable Privacy Policy

Effective date: September 2, 2026
Applicable version: 2.1.0

## Single purpose

oneVegetable is a user-operated local Alibaba.com operations workspace for managing products, the gallery (Photo Bank), RFQs, trades, international logistics, related Open Platform capabilities, and user-selected gallery media published to business social accounts connected by the user. The extension does not provide advertising, tracking, or data services unrelated to this purpose.

## Data processed

- App Key, App Secret, Access Token, signature algorithm, and gateway address entered by the user or obtained through the user-initiated authorization assistant;
- product Schema drafts and RFQ quotation drafts created by the user;
- local product display mutation jobs created by a user action, including product IDs, platform-encrypted IDs, original and target states, requestIds, available traceIds, job status, and redacted error summaries;
- product, gallery, RFQ, trade, logistics, and data insight responses requested from the user's Alibaba.com Open Platform account;
- one gallery image, caption, destination Page or professional account, publishing status, and platform post identifier selected for a user-confirmed social publication;
- the BFF origin, device name, 30-day device token, expiry time, and redacted device metadata created when the user pairs a self-hosted backend;
- a PNG of the currently visible application area generated temporarily in page memory after the user explicitly clicks the feedback screenshot action;
- up to 100 recent session-scoped redacted diagnostics containing operation names, requestIds, durations, error codes, and available traceIds.

Credentials and settings are encrypted in `chrome.storage.local` with an AES-256-GCM key derived from the user's passphrase using PBKDF2-HMAC-SHA256 with 600,000 iterations. The passphrase is not stored. To avoid repeated unlock prompts after an MV3 service worker becomes dormant, derived key material is held in the in-memory `chrome.storage.session` after unlock and bound to the current ciphertext version and last activity time. It contains no credential plaintext and is cleared when the browser restarts, the extension is disabled, updated, or reloaded, the user locks it, or the selected idle timeout expires. Product display mutation jobs are also stored in `chrome.storage.local`, but do not contain App Secrets, tokens, complete requests, or complete responses. Incomplete jobs remain until verification or recovery; terminal jobs are retained for at most 30 days and 100 entries. Drafts are stored in the extension's own `localStorage`. Redacted diagnostics are also stored in `chrome.storage.session` and are not retained as long-term logs after the browser session ends. The extension runs no first-party analytics or advertising service and does not send this data to a developer-operated server.

Both `chrome.storage.local` and `chrome.storage.session` use Chrome `TRUSTED_CONTEXTS`; web pages and extension content scripts cannot read them through the Storage API. A new vault does not enable idle auto-lock by default. The user may opt in to a 5, 15, 30, or 60 minute timeout. When enabled, status checks do not extend the timer; only an actual credential read or update does. Normal service worker dormancy does not end the current Chrome session's unlocked state.

A forgotten vault passphrase cannot be recovered. The user must erase all extension-local data and configure the credentials again. Legacy plaintext credentials are never used for real requests. After the user creates a new passphrase, the service worker performs the encryption migration in place without returning the old App Secret or Access Token to a page.

After the user starts the authorization assistant, packaged extension code runs only in the known Alibaba Application Center and OAuth tabs for that attempt. It reads the selected existing application configuration and validates the OAuth callback. The extension does not collect the user's Alibaba website password. The user handles CAPTCHA, slider, MFA, and secret-view verification directly on Alibaba pages. App Secret, OAuth code, and tokens are processed only in service-worker memory; the validated code is exchanged immediately and is never persisted. Complete credentials are stored only when the user chooses encrypted vault storage, or exported to a local JSON file after acknowledging the plaintext-secret risk.

The user may also explicitly choose cloud authorization in the administration page of their self-hosted Cloudflare Worker. In that flow, the Alibaba website account and password exist only in that HTTPS request and the temporary Browser Run session memory. They are not written to D1, application logs, audit events, screenshots, or browser recordings. The temporary job stores only public state and a session identifier. CAPTCHA, slider, MFA, secret-view verification, bot rejection, or exhausted browser quota ends the attempt and directs the user to the local extension. The cloud flow does not create an application, request API permissions, fill developer registration details, or accept agreements for the user. On success, complete credentials are encrypted directly in the user's own Worker, and the administration page never displays the secrets.

The user may explicitly pair the extension with a oneVegetable BFF under the user's control for single-image publishing to a Facebook Page or Instagram professional account. Chrome requests optional access only for the exact BFF origin entered by the user. After a BFF administrator approves the one-time pairing code, a 30-day device token is stored in trusted `chrome.storage.local` and is never displayed by the extension UI. It can only read social destinations and create or inspect social publishing jobs; it cannot read Meta App Secrets, platform tokens, BFF users, or Alibaba credentials. Local disconnect deletes the token, and a BFF administrator can revoke the device server-side.

## Data use and transfer

Real queries and product display changes are sent only after a user action and confirmation. The extension service worker sends them over HTTPS to the Alibaba.com Open Platform gateway configured by the user. Before a product display change leaves the extension, the plaintext product ID, platform-encrypted ID, and current state are cross-checked; accepted changes are verified by reading the product list. An external image is downloaded from the specified public HTTP(S) URL and uploaded to the user's own international gallery only after the user explicitly starts that transfer.

Social media is sent only after the user chooses one image, a destination and a caption and confirms the publication twice. The extension sends that data to the user's configured oneVegetable BFF, which calls the Meta Graph API with the Meta application and connection configured by that user. A Cloudflare deployment temporarily stores the image in the user's private R2 bucket; a Node deployment uses the user's server-local temporary directory. Temporary images are retained for at most 24 hours and publishing metadata for at most 30 days. The extension never holds a Meta App Secret, user token, or Page token and does not send the image to a server controlled by the project developer.

A feedback screenshot is generated locally only after the user clicks “Capture current page” and is shown to the user for review first. The application excludes the feedback dialog and masks password inputs plus marked credentials, tokens, bank accounts, and buyer contact information. The screenshot exists only in current-page memory and is released when it is replaced, deleted, the dialog closes, or the user proceeds to GitHub. When the user clicks “Copy screenshot and open GitHub,” the PNG is written to the local clipboard; if the browser refuses image clipboard access, it is downloaded locally instead. The application only opens a prefilled public GitHub Issue page. It does not upload the screenshot, use a GitHub token, paste the image, or submit the Issue for the user. The user must review the public content again before submitting it on GitHub.

Use of user data follows the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide or improve the disclosed single purpose and is not used for personalized advertising, credit assessment, or data resale. The developer does not permit a person to read user data unless the user explicitly authorizes technical support, a security investigation requires it, or the law requires it.

## Permissions

- `storage`: stores local encrypted credentials, settings, onboarding state, product display mutation jobs, a user-paired social-backend device token, and derived unlock material plus redacted diagnostics held only in the current Chrome session memory;
- `scripting`: injects fixed packaged code only into the known Alibaba Application Center and OAuth tabs after the user explicitly starts the authorization assistant;
- `https://eco.taobao.com/*`: calls the official Alibaba.com HTTPS Open Platform gateway;
- optional `http://*/*` and `https://*/*`: Chrome access is requested for a specific host only when the user starts the authorization assistant, confirms the actual OAuth callback, configures a custom gateway, pairs a user-controlled social publishing BFF, or explicitly transfers an external image. The user can revoke each grant in Settings.

The extension does not request cookies, browsing history, `tabs`, `webNavigation`, or a required `<all_urls>` permission. The authorization assistant does not create applications, accept platform agreements for the user, or bypass human verification. Gallery group management, image upload, external image transfer, and product display changes occur only after an explicit user action and confirmation. Other real write operations remain blocked before any network request leaves the extension background.

## Data control and retention

Settings lets the user lock the vault, change the passphrase, inspect and export an inventory that contains no secret values, clear session diagnostics, disconnect the social publishing backend, revoke extra host permissions, and permanently erase credentials, device tokens, settings, product display mutation jobs, drafts, and diagnostics. A server-side device should be revoked in the user's own BFF administration page. Uninstalling the extension also removes extension-local storage managed by Chrome.

## Security and limitations

Extension pages use a Manifest V3 CSP and do not execute remote code. App Secret is decrypted and used for signing only by the extension service worker. Local encryption reduces static-storage exposure but cannot protect an unlocked runtime, a browser controlled by malware, or the user's compromised device. Higher-security deployments should use a BFF controlled by the user. Alibaba.com determines platform permissions, business qualifications, and current API availability. The extension does not fabricate successful results when access is unavailable.

## Contact and changes

Project homepage and issue tracker: [github.com/OKFred/oneVegetable](https://github.com/OKFred/oneVegetable). If data practices change materially, the extension will update its prominent disclosure and obtain user consent before processing newly disclosed data.
