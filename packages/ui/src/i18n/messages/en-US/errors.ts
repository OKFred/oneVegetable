const authorizationChanged =
  'An authorization changed. Reload both profiles and review unfinished tasks; nothing was automatically retried.';

export const errors = {
  codes: {
    TOP_APPLICATION_REQUIRED:
      'No usable legacy TOP application was found. This console is for IOP: use the IOP authorization tool, or import or enter existing TOP credentials in Settings.',
    ALIBABA_AUTHORIZATION_BINDING_REQUIRED:
      'Check that both TOP and IOP authorizations are configured, then reload their status in credential settings.',
    ALIBABA_AUTHORIZATION_BINDING_CHANGED: authorizationChanged,
    ALIBABA_AUTHORIZATION_BINDING_STALE: authorizationChanged,
    ALIBABA_PROTOCOL_SELECTION_REQUIRED:
      'Choose TOP or IOP explicitly before replacing credentials. The other authorization must be preserved.',
    ALIBABA_PROTOCOL_CREDENTIALS_NOT_CONFIGURED:
      'The requested protocol has no credentials. Configure that profile; the other grant cannot be reused for it.',
    ALIBABA_PROTOCOL_INVALID: 'Invalid gateway protocol. Explicitly choose TOP or IOP.',
    ALIBABA_IOP_METHOD_UNSUPPORTED:
      'This method is not mapped to IOP. Choose a supported method; no TOP fallback.',
    ALIBABA_IOP_PARAMETER_UNSUPPORTED:
      'IOP does not support this filter. Request blocked; never silently ignored.',
    ALIBABA_IOP_MUTATION_UNVERIFIED:
      'This IOP write method has not passed account verification and remains disabled.',
    ALIBABA_IOP_BUSINESS_REJECTED:
      'The platform explicitly rejected this IOP operation. Check business conditions; do not resubmit.',
    ALIBABA_IOP_PHOTO_GROUP_REQUIRED:
      'Choose a specific group for IOP photos; all photos and ungrouped photos are unsupported.',
    ALIBABA_IOP_PHOTO_SCOPE_MISMATCH:
      'IOP returned images from another group. Stopped safely; consider adding TOP authorization.',
    ALIBABA_PROTOCOL_ENDPOINT_MISMATCH:
      'The protocol and gateway endpoint do not match. Check the TOP or IOP configuration.',
    ALIBABA_IOP_RESPONSE_INVALID:
      'Unexpected IOP response format. Check the configuration and endpoint; no TOP fallback.',
    ALIBABA_IOP_API_REJECTED:
      'Alibaba IOP rejected the request. Check authorization and endpoint permissions.',
    PRODUCT_CONTEXT_CHANGED:
      'Your account or Alibaba credentials changed. Select products and preview again; do not resubmit old tasks.',
    PRODUCT_CONTEXT_UNAVAILABLE:
      'The account context is unavailable. Check your login and Alibaba credentials.',
    PRODUCT_CONTEXT_INVALID: 'Invalid product operation context. Reopen batch maintenance.',
    PRODUCT_BATCH_STATE_CHANGED:
      'The product category or status no longer allows maintenance. Refresh the list and preview again.',
    PRODUCT_BATCH_RECEIPT_MISSING:
      'No reliable task receipt was received. Check Product tasks; do not submit again.',
    PRODUCT_BATCH_ALREADY_STARTED: 'This run has already started. Preview unsent products again.',
    PRODUCT_BATCH_RANGE_INVALID: 'Select 1–30 distinct products from the current page.',
    PRODUCT_BATCH_STOPPED: 'Subsequent submissions have stopped.',
    S3_CONTENT_LENGTH_REQUIRED:
      'Storage did not receive Content-Length. Ask your administrator to check proxy chunked transfer settings; do not retry the upload.',
    S3_REQUEST_FAILED:
      'S3 could not complete the request. Check the storage error code and task result before retrying any upload.',
    S3_PERMISSION_REQUIRED: 'Save your S3 settings again and allow access to the storage host.',
    S3_NOT_CONFIGURED: 'Configure S3 asset storage in Settings first.',
    S3_CONFIGURATION_INVALID: 'Invalid S3 configuration. Check the HTTPS endpoint, bucket and credentials.',
    S3_CONFIGURATION_CORRUPT:
      'Local S3 credentials cannot be decrypted. Clear local data and configure S3 again.',
    S3_UNTRUSTED_SENDER: 'Only the extension workbench can access S3.',
    S3_RESPONSE_INVALID: 'Invalid S3 background response. Reopen the workbench.',
    S3_OBJECT_TOO_LARGE: 'An S3 asset must not exceed 5 MiB.',
    S3_STORAGE_FAILED:
      'S3 operation failed. Check host permissions, credentials and connectivity. After an upload error, check storage before retrying.',
    UNKNOWN_ERROR: 'An unknown error occurred.',
    GATEWAY_ERROR: 'The gateway operation failed.',
    INTERNAL_ERROR: 'The service could not complete the operation.',
    INVALID_REQUEST_ID: 'The requestId is invalid.',
    INVALID_REQUEST_BODY: 'The request body is invalid.',
    INVALID_OPERATION_REQUEST: 'The operation request is invalid.',
    INVALID_OPERATION_PAYLOAD: 'The operation payload is invalid.',
    INVALID_RUNTIME_RESPONSE: 'The extension background response is invalid.',
    INVALID_BFF_RESPONSE: 'The BFF response is invalid.',
    REQUEST_CONTRACT_INVALID: 'The request did not pass contract validation.',
    INVALID_JSON: 'The request is not valid JSON.',
    INVALID_JSON_RESPONSE: 'The upstream response is not valid JSON.',
    INVALID_CONTENT_TYPE: 'The content type is not supported.',
    ROUTE_NOT_FOUND: 'The API route does not exist.',
    SERVICE_NOT_READY: 'The service is not ready.',
    NETWORK_ERROR:
      'Connection failed. Check your network and reload. For write operations, verify the result first.',
    REQUEST_TIMEOUT: 'The network request timed out or was cancelled.',
    RETRY_EXHAUSTED: 'All request retries were exhausted.',
    NETWORK_REDIRECT_DENIED: 'Network redirects are not allowed.',
    NETWORK_REQUEST_SIZE_INVALID: 'The declared request size is invalid.',
    NETWORK_REQUEST_TOO_LARGE: 'The request exceeds the size limit.',
    NETWORK_RESPONSE_TOO_LARGE: 'The response exceeds the size limit.',
    NETWORK_SERVICE_NOT_CONFIGURED: 'The network service is not configured.',
    NETWORK_URL_DENIED: 'The network target is not in the allowlist.',
    AUTHENTICATION_FAILED: 'Alibaba upstream authentication failed.',
    PERMISSION_DENIED: 'The current account is not allowed to perform this operation.',
    RATE_LIMITED: 'Too many requests. Try again later.',
    UPSTREAM_UNAVAILABLE: 'The upstream service is temporarily unavailable.',
    ALIBABA_ERROR: 'The Alibaba API returned an error.',
    ALIBABA_GATEWAY_DISABLED: 'The Alibaba gateway is disabled.',
    ALIBABA_CREDENTIALS_NOT_CONFIGURED: 'Alibaba Open Platform credentials are not configured.',
    ALIBABA_CREDENTIALS_INCOMPLETE: 'Alibaba Open Platform credentials are incomplete.',
    ALIBABA_ACCESS_TOKEN_EXPIRED: 'The Alibaba Access Token has expired.',
    ALIBABA_REFRESH_TOKEN_EXPIRED: 'The Alibaba Refresh Token has expired. Authorize again.',
    ALIBABA_REFRESH_TOKEN_MISSING: 'The Alibaba Refresh Token is missing. Authorize again.',
    ALIBABA_TOKEN_REFRESH_FAILED: 'The Alibaba Token refresh failed. Authorize again.',
    TOP_TOKEN_REJECTED:
      'The platform rejected the TOP token refresh request. Check the application authorization and permissions, or authorize TOP again.',
    AUTH_REFRESH_RESULT_UNKNOWN:
      'The refresh result is unknown. Do not resend this refresh request; reauthorize this protocol and import the new authorization.',
    AUTH_REFRESH_EXPIRED:
      'The recorded refresh period has expired. Reauthorize this protocol and import the new authorization.',
    AUTH_PERMISSION_REQUIRED:
      'Allow the selected protocol’s required host first: https://oauth.alibaba.com for TOP, or https://openapi-api.alibaba.com for IOP. Then try renewal.',
    ALIBABA_DRAFT_UPDATE_UNSUPPORTED:
      'Alibaba does not currently support overwriting an existing platform draft.',
    ALIBABA_PRODUCT_GROUP_CREATE_UNCONFIRMED: 'Product-group creation is not enabled in this environment.',
    MISSING_CREDENTIALS: 'Configure the App Key, App Secret, and Access Token in Settings first.',
    CREDENTIAL_VAULT_EMPTY: 'Configure Open Platform credentials in Settings first.',
    CREDENTIAL_VAULT_LOCKED: 'Open Platform credentials are locked. Unlock them in Settings first.',
    CREDENTIAL_VAULT_IDLE_TIMEOUT:
      'Previously locked credentials still need one unlock with the original passphrase. This device then remembers unlocking until you lock manually.',
    CREDENTIAL_VAULT_SESSION_ENDED:
      'Existing credentials still need one unlock with the original passphrase. Browser restarts and extension updates will then keep them unlocked.',
    CREDENTIAL_VAULT_INVALID: 'Credential storage is invalid. Clear local data and configure it again.',
    CREDENTIAL_VAULT_MIGRATION_REQUIRED: 'Legacy plaintext credentials must be encrypted locally first.',
    CREDENTIAL_VAULT_PASSPHRASE_REQUIRED:
      'Set a local passphrase before saving to the extension for the first time.',
    CREDENTIAL_VAULT_ALREADY_CONFIGURED: 'Credentials already exist and cannot be created again.',
    CREDENTIAL_VAULT_MIGRATION_NOT_AVAILABLE: 'There are no legacy plaintext credentials to migrate.',
    INVALID_CREDENTIAL_VAULT_OPERATION: 'This credential protection operation is not supported.',
    CREDENTIAL_STORE_FAILED: 'Could not save the credentials.',
    VAULT_UNLOCK_FAILED: 'The vault passphrase is incorrect or the encrypted data is damaged.',
    VAULT_INVALID: 'The credential vault format is invalid.',
    HOST_PERMISSION_DENIED: 'The required site access was not granted.',
    INVALID_HOST_PERMISSION: 'The site access permission is invalid.',
    REAL_MUTATION_DISABLED: 'This environment has not enabled this real write operation.',
    REAL_MUTATIONS_PAUSED: 'An administrator paused all real write operations.',
    STATIC_DISABLED: 'This capability is currently disabled.',
    CAPABILITY_NOT_ACTIVE: 'This capability is not active.',
    CAPABILITY_UNKNOWN: 'This capability is not recognized.',
    CAPABILITY_DEFINITION_MISSING: 'This capability has no typed definition yet.',
    CAPABILITY_NOT_AUDITED: 'The API is not in the audited free, non-Jushita catalog.',
    CAPABILITY_RESTRICTED: 'The API requires additional business permissions.',
    CAPABILITY_NOT_INTEGRATED: 'The API contract, adapter, and tests are not complete.',
    PRODUCT_MUTATION_LIFECYCLE_ERROR: 'The product-write verification flow failed.',
    PRODUCT_MUTATION_JOB_NOT_FOUND: 'The product-write job does not exist.',
    PRODUCT_MUTATION_STATUS_INVALID: 'The product-write job status is invalid.',
    PRODUCT_MUTATION_LIST_INVALID: 'The product-write job pagination is invalid.',
    PRODUCT_MUTATION_JOB_INVALID: 'The product-write job data is invalid.',
    PRODUCT_MUTATION_FINGERPRINT_REQUIRED:
      'The product update is missing its trusted-page security fingerprint.',
    PRODUCT_MUTATION_FINGERPRINT_INVALID: 'The product-update security fingerprint is invalid.',
    PRODUCT_MUTATION_FINGERPRINT_MISMATCH: 'The product update does not match its security fingerprint.',
    PRODUCT_MUTATION_READBACK_INVALID: 'The product-update readback result is invalid.',
    PRODUCT_MUTATION_READBACK_CLIENT_REQUIRED: 'Verify the product update from the extension workspace.',
    PRODUCT_MUTATION_READBACK_UNAVAILABLE: 'This page cannot verify the product update.',
    EXTENSION_TRUSTED_PAGE_REQUIRED: 'This action can only be started from the extension workspace.',
    PRODUCT_MUTATION_GATEWAY_INVALID:
      'The current product gateway does not support the required readback operation.',
    PRODUCT_MUTATION_RECOVERY_UNAVAILABLE: 'This product job cannot be recovered automatically.',
    PRODUCT_DRAFT_READBACK_MISMATCH: 'The platform draft readback does not match the local job.',
    TRADE_MUTATION_UNVERIFIED: 'Trade Assurance order writes are not enabled in this environment.',
    CSRF_INVALID: 'CSRF validation failed. Refresh the page and try again.',
    SESSION_REQUIRED: 'Sign in first.',
    SESSION_INVALID: 'The sign-in session is invalid. Sign in again.',
    SESSION_EXPIRED: 'The sign-in session expired. Sign in again.',
    INVALID_CREDENTIALS: 'The username or password is incorrect.',
    INVALID_PASSWORD: 'Use at least 6 characters. If the password is too long, shorten it and try again.',
    LOGIN_LOCKED: 'Too many failed sign-in attempts. Try again later.',
    USER_DISABLED: 'This user is disabled.',
    ENTITY_VERSION_CONFLICT: 'The data was updated elsewhere. Refresh and try again.',
    INVALID_OPERATION_AVAILABILITY_REQUEST: 'The operation-availability request is invalid.',
    LOGISTICS_QUALIFICATION_REQUIRED:
      'This international logistics capability requires additional business eligibility.',
    REPLAY_MISSING: 'No documentation replay is available for this API.',
    SOCIAL_BACKEND_URL_INVALID: 'The social publishing backend URL is invalid.',
    EXTENSION_SOCIAL_BACKEND_NOT_CONFIGURED: 'Configure the social publishing backend in Settings first.',
    EXTENSION_SOCIAL_BACKEND_NOT_PAIRED: 'Pair the social publishing backend first.',
    EXTENSION_DEVICE_EXPIRED: 'The extension device authorization expired. Pair it again.',
    EXTENSION_DEVICE_UNAUTHORIZED: 'The extension device authorization is invalid.',
    META_APP_NOT_CONFIGURED: 'The Meta application is not configured.',
    META_PERMISSION_MISSING: 'The Meta account is missing a required permission.',
    META_DESTINATION_NOT_AVAILABLE: 'This Meta publishing destination is unavailable.',
    META_CONNECTION_RECONNECT_REQUIRED: 'The Meta account must be reconnected.',
    META_PUBLISH_FAILED: 'Meta publishing failed.',
    META_SOCIAL_FAILED: 'The Meta social operation failed.',
    META_NETWORK_FAILED: 'The Meta network request failed.',
    META_RESPONSE_INVALID: 'Meta returned an unrecognized response.',
    META_PERMALINK_UNAVAILABLE: 'The Meta post link is temporarily unavailable.',
    SOCIAL_MEDIA_STORAGE_UNAVAILABLE: 'Temporary social-publishing media storage is unavailable.',
    SOCIAL_PUBLISHING_SERVICE_UNAVAILABLE: 'The social publishing service is not ready.',
    SOCIAL_PUBLIC_ORIGIN_REQUIRED: 'Instagram publishing requires a publicly accessible HTTPS origin.',
    SOCIAL_IMAGE_INVALID: 'The image does not meet the current platform requirements.',
    SOCIAL_PUBLISH_JOB_EXPIRED: 'The social publishing job expired.',
    SOCIAL_MEDIA_NOT_FOUND: 'The temporary social-publishing asset does not exist or has expired.',
    IDEMPOTENCY_KEY_CONFLICT: 'The same idempotency key was used for different content.',
    APPLICATION_NOT_FOUND: 'No reusable Alibaba application was found.',
    NO_APPLICATION: 'This account has no reusable Alibaba application.',
    APPLICATION_SELECTION_INVALID: 'The Alibaba application selection is invalid.',
    ACQUISITION_COMMAND_INVALID: 'The Alibaba credential acquisition action is invalid.',
    ACQUISITION_EXPIRED: 'The Alibaba credential acquisition job expired.',
    ACQUISITION_NOT_COMPLETED: 'Alibaba credentials have not been acquired yet.',
    ACQUISITION_SESSION_EXPIRED: 'The Alibaba credential acquisition session expired. Start again.',
    CALLBACK_INVALID: 'The Callback URL is invalid.',
    CALLBACK_UPDATE_FAILED: 'The Callback URL update failed.',
    OAUTH_STATE_MISMATCH: 'OAuth security validation failed.',
    OAUTH_CODE_MISSING: 'The OAuth Callback is missing an authorization code.',
    OAUTH_PROVIDER_ERROR: 'Alibaba denied this OAuth authorization.',
    OAUTH_FAILED: 'OAuth authorization failed.',
    TOKEN_EXCHANGE_FAILED: 'Could not obtain an Alibaba Access Token.',
    ALIBABA_SIGN_METHOD_INVALID: 'The Alibaba signing method is invalid.',
    TEMPLATE_NAME_CONFLICT: 'A template with this name already exists for the selected language.',
    TEMPLATE_NOT_FOUND: 'The product-description template does not exist.',
    TEMPLATE_PAGE_LIMIT_EXCEEDED: 'The product-description template pagination exceeds the limit.',
    TEMPLATE_WRITE_UNAVAILABLE: 'Shared product-description templates cannot be written in this environment.',
    TEMPLATE_PACKAGE_INVALID: 'Invalid template package. Use a JSON file exported from Templates.',
    TEMPLATE_PACKAGE_TOO_LARGE: 'Template packages must not exceed 5 MiB.',
    TEMPLATE_STORAGE_UNAVAILABLE:
      'Local template storage is unavailable. Check storage access and free space.',
    TEMPLATE_STORAGE_INVALID:
      'Local template records are damaged. Back up and inspect them before continuing.',
    TEMPLATE_STORAGE_LIMIT: 'Local storage holds up to 1000 templates. Export a backup and clean up first.',
    TEMPLATE_PREFIX_INVALID: 'Enter a relative S3 prefix without parent-path segments.',
    TEMPLATE_CONTEXT_CHANGED: 'The identity or S3 configuration changed. Reopen and preview again.',
    TEMPLATE_BACKUP_UNCONFIRMED: 'The S3 readback does not match. Check the file; do not upload it again.'
  }
} as const;
