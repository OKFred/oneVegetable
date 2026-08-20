export interface AlibabaOpenApiPermission {
  name: string;
  status: string;
}

export interface AlibabaOpenApiCredentialBundle {
  schemaVersion: 1;
  capturedAtUtc: string;
  application: {
    appName: string;
    appKey: string;
    appSecret: string;
    callbackUrl: string;
    status: string;
    permissions: AlibabaOpenApiPermission[];
  };
  oauth: {
    accessToken: string;
    refreshToken: string | null;
    expiresAtUtc: string | null;
    refreshExpiresAtUtc: string | null;
  };
  callback: {
    receivedAtUtc: string;
    stateMatched: true;
    callbackOrigin: string;
    callbackPath: string;
  };
}

export type OpenApiAuthStage =
  | 'configuration'
  | 'browser'
  | 'login'
  | 'application'
  | 'callback-update'
  | 'authorization'
  | 'token-exchange'
  | 'storage'
  | 'complete';

export interface OpenApiAuthDiagnostic {
  schemaVersion: 1;
  capturedAtUtc: string;
  ok: boolean;
  stage: OpenApiAuthStage;
  targetUrl: string;
  currentUrl: string | null;
  selectedApplication: {
    appName: string | null;
    appKeySuffix: string | null;
    status: string | null;
  };
  callback: {
    configuredOrigin: string | null;
    configuredPath: string | null;
    updated: boolean;
    stateMatched: boolean;
  };
  error: {
    code: string;
    message: string;
  } | null;
  savedFiles: string[];
}

export interface AlibabaTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  refreshExpiresInSeconds: number | null;
}
