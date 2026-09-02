import type { SocialPublishingClient } from './social-publishing-client';
import type { ExtensionSocialDevice } from './social-meta';

export const EXTENSION_SOCIAL_BACKEND_STORAGE_KEY = 'one-vegetable-extension-social-backend';

export interface ExtensionSocialBackendStatus {
  state: 'unconfigured' | 'pending' | 'paired' | 'expired';
  baseUrl: string | null;
  extensionId: string;
  deviceName: string | null;
  pairingCode: string | null;
  pairingExpiresTimeUtc: number | null;
  device: ExtensionSocialDevice | null;
}

export interface ExtensionSocialBackendRepository {
  status(): Promise<ExtensionSocialBackendStatus>;
  start(baseUrl: string, deviceName: string): Promise<ExtensionSocialBackendStatus>;
  refresh(): Promise<ExtensionSocialBackendStatus>;
  disconnect(): Promise<ExtensionSocialBackendStatus>;
}

export interface ExtensionSocialRuntimeServices {
  backend: ExtensionSocialBackendRepository;
  publishing: SocialPublishingClient;
}
