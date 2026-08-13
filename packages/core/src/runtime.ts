export { GatewayException, normalizeGatewayError } from './errors';
export { ALIBABA_GATEWAY } from './signing';
export { migrateGatewaySettings, persistGatewaySettings, SETTINGS_STORAGE_KEY } from './settings-storage';
export {
  approximateStorageBytes,
  completeOnboarding,
  createLocalDataInventory,
  ONBOARDING_STORAGE_KEY,
  readOnboardingState
} from './privacy';
export type {
  GatewayClient,
  GatewaySettings,
  HostPermissionsRepository,
  LocalDataCategory,
  LocalDataInventory,
  LocalDataRepository,
  OnboardingRepository,
  OnboardingState,
  OperationId,
  RequestOf,
  ResponseOf,
  RuntimeRequest,
  RuntimeResponse,
  SettingsRepository
} from './types';
