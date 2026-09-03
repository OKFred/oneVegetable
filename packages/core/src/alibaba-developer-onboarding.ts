import type {
  AlibabaCredentialAcquisitionPrerequisiteReason,
  AlibabaCredentialAcquisitionState
} from './alibaba-credential-acquisition';

export const ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY = 'one-vegetable:alibaba-developer-onboarding:v1';

export interface AlibabaDeveloperOnboardingSnapshot {
  schemaVersion: 1;
  reasonCode: AlibabaCredentialAcquisitionPrerequisiteReason;
  checkedAtUtc: number;
}

export type AlibabaCredentialPrerequisiteState = Extract<
  AlibabaCredentialAcquisitionState,
  { status: 'prerequisite-required' }
>;

const PREREQUISITE_REASONS = new Set<AlibabaCredentialAcquisitionPrerequisiteReason>([
  'developer-registration-required',
  'developer-registration-under-review',
  'developer-registration-rejected',
  'application-required',
  'application-not-ready'
]);

export function createAlibabaDeveloperOnboardingSnapshot(
  state: AlibabaCredentialPrerequisiteState
): AlibabaDeveloperOnboardingSnapshot {
  return {
    schemaVersion: 1,
    reasonCode: state.reasonCode,
    checkedAtUtc: state.checkedAtUtc
  };
}

export function parseAlibabaDeveloperOnboardingSnapshot(
  value: unknown,
  now = Date.now()
): AlibabaDeveloperOnboardingSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (typeof value.reasonCode !== 'string' || !isPrerequisiteReason(value.reasonCode)) return null;
  const checkedAtUtc = value.checkedAtUtc;
  if (typeof checkedAtUtc !== 'number' || !Number.isSafeInteger(checkedAtUtc) || checkedAtUtc <= 0) {
    return null;
  }
  if (checkedAtUtc > now + 60_000) return null;
  return {
    schemaVersion: 1,
    reasonCode: value.reasonCode,
    checkedAtUtc
  };
}

export function snapshotToAlibabaCredentialPrerequisiteState(
  snapshot: AlibabaDeveloperOnboardingSnapshot
): AlibabaCredentialPrerequisiteState {
  return {
    status: 'prerequisite-required',
    reasonCode: snapshot.reasonCode,
    checkedAtUtc: snapshot.checkedAtUtc
  };
}

function isPrerequisiteReason(value: string): value is AlibabaCredentialAcquisitionPrerequisiteReason {
  return PREREQUISITE_REASONS.has(value as AlibabaCredentialAcquisitionPrerequisiteReason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
