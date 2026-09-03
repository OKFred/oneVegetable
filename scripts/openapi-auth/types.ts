export type {
  AlibabaOpenApiCredentialBundle,
  AlibabaOpenApiPermission,
  AlibabaTokenResponse
} from '../../packages/core/src/alibaba-credential-bundle';

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

export interface OpenApiAuthPrerequisite {
  status: 'prerequisite-required';
  reasonCode:
    | 'developer-registration-required'
    | 'developer-registration-under-review'
    | 'developer-registration-rejected'
    | 'application-required'
    | 'application-not-ready';
  checkedAtUtc: number;
}

export interface OpenApiAuthDiagnostic {
  schemaVersion: 1;
  capturedAtUtc: string;
  ok: boolean;
  stage: OpenApiAuthStage;
  targetUrl: string;
  currentUrl: string | null;
  prerequisite: OpenApiAuthPrerequisite | null;
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
