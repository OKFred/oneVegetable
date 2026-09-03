import type {
  AlibabaCredentialAcquisitionContinueCommand,
  AlibabaCredentialAcquisitionState
} from './alibaba-credential-acquisition';
import type { AlibabaOpenApiCredentialBundle } from './alibaba-credential-bundle';
import type { CredentialVaultStatus, GatewayError } from './types';

export type ExtensionAlibabaCredentialAcquisitionOperation =
  | 'start'
  | 'continue'
  | 'status'
  | 'cancel'
  | 'save-to-vault'
  | 'export-bundle'
  | 'read-prerequisite'
  | 'locate-prerequisite-field'
  | 'focus-prerequisite-page';

export interface ExtensionAlibabaCredentialAcquisitionRequest {
  requestId: string;
  kind: 'alibaba-credential-acquisition-request';
  operation: ExtensionAlibabaCredentialAcquisitionOperation;
  payload?: unknown;
}

export type ExtensionAlibabaCredentialAcquisitionResponse =
  { requestId: string; ok: true; data: unknown } | { requestId: string; ok: false; error: GatewayError };

export interface ExtensionAlibabaCredentialAcquisitionRepository {
  start(callbackUrl: string | null): Promise<AlibabaCredentialAcquisitionState>;
  continue(
    jobId: string,
    command: AlibabaCredentialAcquisitionContinueCommand
  ): Promise<AlibabaCredentialAcquisitionState>;
  status(jobId: string): Promise<AlibabaCredentialAcquisitionState>;
  cancel(jobId: string): Promise<AlibabaCredentialAcquisitionState>;
  saveToVault(passphrase?: string): Promise<CredentialVaultStatus>;
  exportBundle(): Promise<AlibabaOpenApiCredentialBundle>;
  readPrerequisite(): Promise<Extract<
    AlibabaCredentialAcquisitionState,
    { status: 'prerequisite-required' }
  > | null>;
  locatePrerequisiteField(): Promise<string | null>;
  focusPrerequisitePage(): Promise<void>;
}
