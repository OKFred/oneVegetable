import { describe, expect, it } from 'vitest';

import { withMetaSocialRuntime } from '../src/social-meta/runtime-summary';

import type { MetaAppConfigurationSummary } from '@one-vegetable/core';

const configuration: MetaAppConfigurationSummary = {
  configured: true,
  appIdSuffix: '6789',
  graphApiVersion: 'v26.0',
  publicOrigin: 'https://one-vegetable.example.com',
  callbackUrl: 'https://one-vegetable.example.com/api/v1/social/meta/oauth/callback',
  revision: 2,
  updateTimeUtc: 1_788_192_000_000,
  updaterId: 'admin-1',
  remark: null
};

describe('Meta social runtime summary', () => {
  it('reports a ready Cloudflare R2 publishing runtime', () => {
    expect(
      withMetaSocialRuntime(configuration, {
        runtime: 'cloudflare',
        mediaStorage: 'r2',
        publishingRuntimeAvailable: true
      })
    ).toMatchObject({
      apiRuntime: 'cloudflare',
      mediaStorage: 'r2',
      publishingRuntimeAvailable: true,
      runtimeIssueCode: null
    });
  });

  it('reports missing media storage before the publishing service', () => {
    expect(
      withMetaSocialRuntime(configuration, {
        runtime: 'cloudflare',
        mediaStorage: 'unavailable',
        publishingRuntimeAvailable: false
      }).runtimeIssueCode
    ).toBe('SOCIAL_MEDIA_STORAGE_UNAVAILABLE');
  });
});
