import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/alibaba-auth/protocol-discovery.json';
const mocks = vi.hoisted(() => ({
  tab: vi.fn(),
  apps: vi.fn(),
  secret: vi.fn(),
  guide: vi.fn(),
  update: vi.fn()
}));
vi.mock('wxt/browser', () => ({ browser: { tabs: { update: mocks.update } } }));
vi.mock('../lib/alibaba-credential-page-driver', () => ({
  findAlibabaLegacyApplicationTab: mocks.tab,
  readAlibabaLegacyApplications: mocks.apps,
  revealAlibabaLegacyApplicationSecret: mocks.secret,
  showAlibabaAuthorizationGuide: mocks.guide
}));
import { readTopApplication } from '../lib/top-application-reader';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tab.mockResolvedValue(3);
  mocks.apps.mockResolvedValue([{ ...fixture.top, source: 'legacy-crosstrade' }]);
  mocks.secret.mockResolvedValue({ status: 'available', appSecret: 'fixture-top-secret-only' });
  mocks.guide.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(undefined);
});
describe('legacy TOP app reading', () => {
  it('uses the legacy key and Callback, with no IOP substitution', async () => {
    const result = await readTopApplication();
    expect(result).toMatchObject({ appKey: fixture.top.appKey, callbackUrl: fixture.top.callbackUrl });
    expect(mocks.secret).toHaveBeenCalledExactlyOnceWith(3, fixture.top.appKey);
    expect(mocks.guide).toHaveBeenCalledWith(3, 'top', 'ready');
  });
  it('reports an unavailable legacy page without opening a retired address', async () => {
    mocks.tab.mockResolvedValue(null);
    await expect(readTopApplication()).rejects.toMatchObject({
      gatewayError: { code: 'TOP_APP_NOT_AVAILABLE' }
    });
    expect(mocks.secret).not.toHaveBeenCalled();
    expect(mocks.apps).not.toHaveBeenCalled();
  });
  it.each([
    { apps: [] },
    { apps: [{ ...fixture.iop, source: 'application-center' }] },
    { apps: [{ ...fixture.top, source: 'legacy-crosstrade', callbackUrl: null }] }
  ])('does not guess missing legacy information', async ({ apps }) => {
    mocks.apps.mockResolvedValue(apps);
    await expect(readTopApplication()).rejects.toMatchObject({
      gatewayError: { code: 'TOP_APP_NOT_AVAILABLE' }
    });
    expect(mocks.secret).not.toHaveBeenCalled();
  });
  it('does not choose an arbitrary app from multiple legacy applications', async () => {
    mocks.apps.mockResolvedValue([fixture.top, fixture.top]);
    await expect(readTopApplication()).rejects.toMatchObject({
      gatewayError: { code: 'TOP_APP_SELECTION_REQUIRED' }
    });
    expect(mocks.secret).not.toHaveBeenCalled();
  });
});
