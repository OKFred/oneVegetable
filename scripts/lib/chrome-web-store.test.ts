import { describe, expect, it } from 'vitest';

import {
  ChromeWebStoreDraftClient,
  chromeWebStoreAccessTokenFromEnvironment,
  chromeWebStoreTargetFromEnvironment,
  draftUploadUrl,
  itemStatusUrl,
  parseExtensionReleaseManifest
} from './chrome-web-store';

import type { ChromeWebStoreHttpRequest, ChromeWebStoreTransport } from './chrome-web-store';

const target = {
  publisherId: 'publisher_123',
  itemId: 'abcdefghijklmnopabcdefghijklmnop'
};

describe('Chrome Web Store draft upload', () => {
  it('validates release metadata and publishing target without exposing a publish endpoint', () => {
    expect(
      parseExtensionReleaseManifest({
        schemaVersion: 1,
        extensionVersion: '2.0.2',
        artifact: 'one-vegetable-v2.0.2-chrome-mv3.zip',
        sha256: 'a'.repeat(64),
        size: 1024,
        fileCount: 12
      })
    ).toMatchObject({ extensionVersion: '2.0.2' });
    expect(draftUploadUrl(target)).toContain('/upload/v2/');
    expect(itemStatusUrl(target).endsWith(':fetchStatus')).toBe(true);
    expect(draftUploadUrl(target)).not.toContain(':publish');
  });

  it('rejects malformed identifiers and access tokens', () => {
    expect(() =>
      chromeWebStoreTargetFromEnvironment({
        CHROME_WEB_STORE_PUBLISHER_ID: '../publisher',
        CHROME_WEB_STORE_ITEM_ID: target.itemId
      })
    ).toThrow(/PUBLISHER_ID/);
    expect(() => chromeWebStoreAccessTokenFromEnvironment({})).toThrow(/ACCESS_TOKEN/);
  });

  it('uploads once and polls read-only status until the draft succeeds', async () => {
    const requests: ChromeWebStoreHttpRequest[] = [];
    const responses: { status: number; body: unknown }[] = [
      {
        status: 200,
        body: { itemId: target.itemId, uploadState: 'IN_PROGRESS' }
      },
      {
        status: 200,
        body: { itemId: target.itemId, lastAsyncUploadState: 'IN_PROGRESS' }
      },
      {
        status: 200,
        body: { itemId: target.itemId, lastAsyncUploadState: 'SUCCEEDED' }
      }
    ];
    const transport: ChromeWebStoreTransport = (request) => {
      requests.push(request);
      const response = responses.shift();
      if (!response) throw new Error('missing fake response');
      return Promise.resolve(response);
    };
    const client = new ChromeWebStoreDraftClient(target, 'token-with-more-than-twenty-characters', transport);

    await expect(
      client.upload(new Uint8Array([1, 2, 3]), '2.0.2', {
        pollAttempts: 3,
        pollIntervalMilliseconds: 0,
        sleep: () => Promise.resolve()
      })
    ).resolves.toEqual({
      itemId: target.itemId,
      crxVersion: null,
      uploadState: 'SUCCEEDED',
      pollAttempts: 2
    });
    expect(requests.map(({ method }) => method)).toEqual(['POST', 'GET', 'GET']);
    expect(requests[0]?.headers.Authorization).toBe('Bearer token-with-more-than-twenty-characters');
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  it('does not retry a failed upload mutation or leak the token in provider errors', async () => {
    let calls = 0;
    const secret = 'secret-access-token-with-more-than-twenty-characters';
    const transport: ChromeWebStoreTransport = () => {
      calls += 1;
      return Promise.resolve({
        status: 403,
        body: {
          error: { status: 'PERMISSION_DENIED', message: `Publisher access denied ${secret}` }
        }
      });
    };
    const client = new ChromeWebStoreDraftClient(target, secret, transport);

    const error = await client.upload(new Uint8Array([1]), '2.0.2').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('PERMISSION_DENIED');
    expect(String(error)).not.toContain(secret);
    expect(calls).toBe(1);
  });
});
