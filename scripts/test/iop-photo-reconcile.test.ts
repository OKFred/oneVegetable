import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FsPromises from 'node:fs/promises';
import fixture from '../../mock/data/alibaba-auth/iop-photo-responses.json';
import credentialFixture from '../../mock/data/node-gateway-credentials.json';
import { NetworkManager } from '../../packages/core/src/network';

const { readFile, wait } = vi.hoisted(() => ({ readFile: vi.fn(), wait: vi.fn() }));
vi.mock('node:fs/promises', async () => ({
  ...(await vi.importActual<typeof FsPromises>('node:fs/promises')),
  readFile
}));
vi.mock('node:timers/promises', () => ({ setTimeout: wait }));

const originalArgs = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgs;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe('IOP photo reconciler non-success exit', () => {
  it('completes bounded diagnosis but exits nonzero on a foreign-group response', async () => {
    process.argv = [
      'node',
      'reconcile-iop-photobank-real.ts',
      '--confirm-read-only',
      '--credential=fixture-credential',
      '--receipt=fixture-receipt',
      '--sdk-query-form',
      '--photo-page-size=24'
    ];
    process.exitCode = 0;
    readFile.mockImplementation((file: string) =>
      Promise.resolve(
        JSON.stringify(
          file === 'fixture-credential'
            ? { ...credentialFixture.oauthBundle, protocol: 'iop' }
            : { resources: { groupId: '1001', childId: '1003' } }
        )
      )
    );
    wait.mockResolvedValue(undefined);
    const request = vi.spyOn(NetworkManager.prototype, 'request').mockImplementation((input) =>
      Promise.resolve({
        requestId: input.requestId ?? 'fixture-request',
        status: 200,
        ok: true,
        headers: new Headers(),
        data: String(input.url).includes('/group/list') ? fixture.groupRead : fixture.scopedPhotos,
        attempt: 1,
        durationMilliseconds: 1
      })
    );
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await import('../reconcile-iop-photobank-real');
    expect(process.exitCode).toBe(2);
    expect(request).toHaveBeenCalledTimes(2);
    for (const [input] of request.mock.calls) {
      expect(new URL(input.url).origin).toBe('https://openapi-api.alibaba.com');
      expect(input.method).toBe('POST');
      expect(input.maxAttempts).toBe(1);
    }
    const photoRequest = request.mock.calls[1]?.[0];
    expect(photoRequest?.body).toBeInstanceOf(URLSearchParams);
    expect((photoRequest?.body as URLSearchParams).get('pageSize')).toBe('24');
    const logged = output.mock.calls.map(([value]) => String(value)).join('');
    expect(logged).toContain('ALIBABA_IOP_PHOTO_SCOPE_MISMATCH');
    for (const secret of [
      credentialFixture.oauthBundle.application.appSecret,
      credentialFixture.oauthBundle.oauth.accessToken,
      'access_token=',
      'fixture.png',
      'https://sc04.alicdn.com'
    ])
      expect(logged).not.toContain(secret);
  });
});
