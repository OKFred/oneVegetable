import type { MetaAppConfigurationSummary } from '@one-vegetable/core';

export type MetaSocialMediaStorage = 'filesystem' | 'r2' | 'unavailable';

export interface MetaSocialRuntimeContext {
  runtime: 'node' | 'cloudflare';
  mediaStorage: MetaSocialMediaStorage;
  publishingRuntimeAvailable: boolean;
}

export function withMetaSocialRuntime(
  configuration: MetaAppConfigurationSummary,
  runtime: MetaSocialRuntimeContext
): MetaAppConfigurationSummary {
  return {
    ...configuration,
    apiRuntime: runtime.runtime,
    mediaStorage: runtime.mediaStorage,
    publishingRuntimeAvailable: runtime.publishingRuntimeAvailable,
    runtimeIssueCode:
      runtime.mediaStorage === 'unavailable'
        ? 'SOCIAL_MEDIA_STORAGE_UNAVAILABLE'
        : runtime.publishingRuntimeAvailable
          ? null
          : 'SOCIAL_PUBLISHING_SERVICE_UNAVAILABLE'
  };
}
