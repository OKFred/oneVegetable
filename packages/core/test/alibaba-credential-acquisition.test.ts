import { describe, expect, it } from 'vitest';

import {
  createAlibabaCredentialAcquisitionCompletedSummary,
  createAlibabaCredentialAcquisitionFailure,
  createAlibabaCredentialAcquisitionState,
  optionalAlibabaCredentialCallbackUrl,
  resolveAlibabaCredentialApplication,
  transitionAlibabaCredentialAcquisitionState,
  validateAlibabaOAuthCallback
} from '../src/alibaba-credential-acquisition';
import { validateAlibabaCredentialAcquisitionStateInput } from '../src/validation';

import type { AlibabaCredentialApplicationCandidate } from '../src/alibaba-credential-acquisition';
import type { AlibabaOpenApiCredentialBundle } from '../src/alibaba-credential-bundle';

const JOB_ID = '944323be-467a-4c81-9c2e-cf455e1f8d7c';
const NOW = 1_788_054_400_000;

describe('Alibaba credential acquisition contract', () => {
  it('auto-selects one application and exposes only the app key suffix when selection is required', () => {
    expect(resolveAlibabaCredentialApplication([candidate('first', '50001234')])).toMatchObject({
      kind: 'selected',
      application: { applicationId: 'first' }
    });
    expect(
      resolveAlibabaCredentialApplication([candidate('first', '50001234'), candidate('second', '50005678')])
    ).toEqual({
      kind: 'selection-required',
      applications: [
        {
          applicationId: 'first',
          appName: 'oneVegetable-first',
          appKeySuffix: '1234',
          status: 'Online',
          source: 'application-center'
        },
        {
          applicationId: 'second',
          appName: 'oneVegetable-second',
          appKeySuffix: '5678',
          status: 'Online',
          source: 'application-center'
        }
      ]
    });
  });

  it('requires explicit callback confirmation without storing secrets in public state', () => {
    const running = createAlibabaCredentialAcquisitionState(JOB_ID, NOW);
    const confirmation = transitionAlibabaCredentialAcquisitionState(
      running,
      {
        type: 'require-callback-confirmation',
        currentUrl: 'https://seller.example.com/oauth/callback',
        requestedUrl: 'https://app.example.com/alibaba/callback'
      },
      NOW
    );
    expect(confirmation).toEqual({
      status: 'callback-confirmation-required',
      jobId: JOB_ID,
      expiresAtUtc: NOW + 600_000,
      currentUrl: 'https://seller.example.com/oauth/callback',
      requestedUrl: 'https://app.example.com/alibaba/callback'
    });
    expect(JSON.stringify(confirmation)).not.toMatch(/password|secret|access.?token|authorization.?code/iu);
  });

  it('expires active jobs and refuses transitions after a terminal result', () => {
    const running = createAlibabaCredentialAcquisitionState(JOB_ID, NOW);
    expect(transitionAlibabaCredentialAcquisitionState(running, { type: 'resume' }, NOW + 600_000)).toEqual({
      status: 'failed',
      error: createAlibabaCredentialAcquisitionFailure('ACQUISITION_EXPIRED')
    });
    const completed = transitionAlibabaCredentialAcquisitionState(
      running,
      { type: 'complete', credential: createAlibabaCredentialAcquisitionCompletedSummary(bundle()) },
      NOW
    );
    expect(() => transitionAlibabaCredentialAcquisitionState(completed, { type: 'cancel' }, NOW)).toThrow(
      '已经结束'
    );
  });

  it('ends polling with a non-sensitive prerequisite state', () => {
    const running = createAlibabaCredentialAcquisitionState(JOB_ID, NOW);
    const prerequisite = transitionAlibabaCredentialAcquisitionState(
      running,
      { type: 'require-prerequisite', reasonCode: 'developer-registration-under-review' },
      NOW + 1_000
    );

    expect(prerequisite).toEqual({
      status: 'prerequisite-required',
      reasonCode: 'developer-registration-under-review',
      checkedAtUtc: NOW + 1_000
    });
    expect(JSON.stringify(prerequisite)).not.toMatch(/company|registration.?number|file|password|secret/iu);
    expect(() => transitionAlibabaCredentialAcquisitionState(prerequisite, { type: 'resume' }, NOW)).toThrow(
      '已经结束'
    );
    expect(validateAlibabaCredentialAcquisitionStateInput(prerequisite)).toMatchObject({ valid: true });
    expect(
      validateAlibabaCredentialAcquisitionStateInput({
        ...prerequisite,
        companyName: 'must-not-be-accepted'
      })
    ).toMatchObject({ valid: false });
  });

  it('keeps an empty callback unset and rejects private or insecure callbacks', () => {
    expect(optionalAlibabaCredentialCallbackUrl('')).toBeNull();
    expect(optionalAlibabaCredentialCallbackUrl(null)).toBeNull();
    expect(() => optionalAlibabaCredentialCallbackUrl('http://example.com/callback')).toThrow(
      '公共 HTTPS URL'
    );
    expect(() => optionalAlibabaCredentialCallbackUrl('https://127.0.0.1/callback')).toThrow(
      '公共 HTTPS URL'
    );
  });

  it('validates callback path and OAuth state before returning the transient code', () => {
    const registered = new URL('https://app.example.com/alibaba/callback');
    expect(
      validateAlibabaOAuthCallback(
        new URL('https://app.example.com/alibaba/callback?code=short-lived&state=expected'),
        registered,
        'expected'
      )
    ).toBe('short-lived');
    expect(() =>
      validateAlibabaOAuthCallback(
        new URL('https://app.example.com/alibaba/callback?code=short-lived&state=wrong'),
        registered,
        'expected'
      )
    ).toThrow('state 不匹配');
    expect(() =>
      validateAlibabaOAuthCallback(
        new URL('https://app.example.com/other?code=short-lived&state=expected'),
        registered,
        'expected'
      )
    ).toThrow('登记地址不匹配');
  });

  it('creates a completed summary without AppSecret or tokens', () => {
    const summary = createAlibabaCredentialAcquisitionCompletedSummary(bundle());
    expect(summary).toEqual({
      appName: 'oneVegetable',
      appKeySuffix: '1234',
      applicationStatus: 'Online',
      permissions: {
        total: 1,
        items: [{ name: 'Product read', status: 'authorized' }]
      },
      accessTokenExpiresTimeUtc: 1_788_051_600_000,
      refreshTokenExpiresTimeUtc: null
    });
    expect(JSON.stringify(summary)).not.toContain('app-secret');
    expect(JSON.stringify(summary)).not.toContain('access-token');
  });
});

function candidate(applicationId: string, appKey: string): AlibabaCredentialApplicationCandidate {
  return {
    applicationId,
    appName: `oneVegetable-${applicationId}`,
    appKey,
    status: 'Online',
    source: 'application-center'
  };
}

function bundle(): AlibabaOpenApiCredentialBundle {
  return {
    schemaVersion: 1,
    capturedAtUtc: '2026-08-30T00:00:00.000Z',
    application: {
      appName: 'oneVegetable',
      appKey: '50001234',
      appSecret: 'app-secret',
      callbackUrl: 'https://app.example.com/alibaba/callback',
      status: 'Online',
      permissions: [{ name: 'Product read', status: 'authorized' }]
    },
    oauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtUtc: '2026-08-30T01:00:00.000Z',
      refreshExpiresAtUtc: null
    },
    callback: {
      receivedAtUtc: '2026-08-30T00:00:00.000Z',
      stateMatched: true,
      callbackOrigin: 'https://app.example.com',
      callbackPath: '/alibaba/callback'
    }
  };
}
