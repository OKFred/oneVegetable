import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/alibaba-auth/protocol-discovery.json';
import type * as Driver from '../lib/alibaba-credential-page-driver';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  create: vi.fn(),
  inspect: vi.fn(),
  legacy: vi.fn(),
  secret: vi.fn(),
  show: vi.fn(),
  close: vi.fn()
}));
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { onUpdated: { addListener: vi.fn() }, query: mocks.query, create: mocks.create },
    storage: { local: { remove: vi.fn() } }
  }
}));
vi.mock('../lib/alibaba-credential-page-driver', async (original) => ({
  ...(await original<typeof Driver>()),
  inspectAlibabaApplicationCenter: mocks.inspect,
  readAlibabaLegacyApplications: mocks.legacy,
  revealAlibabaLegacyApplicationSecret: mocks.secret,
  hideAlibabaDeveloperGuide: vi.fn(),
  showAlibabaDeveloperGuide: mocks.show,
  closeAlibabaTabs: mocks.close
}));
import { ExtensionAlibabaCredentialAcquisitionController } from '../lib/alibaba-credential-acquisition';
import { findAlibabaLegacyApplicationTab } from '../lib/alibaba-credential-page-driver';

const current: Driver.ExtensionAlibabaApplicationDetails = { ...fixtures.iop, source: 'application-center' };
const legacy: Driver.ExtensionAlibabaApplicationCandidate = { ...fixtures.top, source: 'legacy-crosstrade' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: 100 });
  mocks.query.mockResolvedValue([]);
  mocks.inspect.mockResolvedValue({ application: current, candidates: [] });
  mocks.legacy.mockResolvedValue([legacy]);
  mocks.show.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
});

describe('TOP / IOP application discovery', () => {
  it.each(['500001', 'long-iop-key-123456789'])(
    'never guesses protocol from key %s or opens crosstrade',
    async (appKey) => {
      mocks.inspect.mockResolvedValue({ application: { ...current, appKey }, candidates: [] });
      const controller = new ExtensionAlibabaCredentialAcquisitionController();
      const started = await controller.start(null);
      if (started.status !== 'running') throw new Error('Missing fixture task');
      const result = await controller.status(started.jobId);
      expect(result).toMatchObject({ status: 'failed', error: { code: 'TOP_APPLICATION_REQUIRED' } });
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        url: 'https://i.alibaba.com/explore/open-api',
        active: true
      });
      expect(mocks.legacy).not.toHaveBeenCalled();
      expect(mocks.secret).not.toHaveBeenCalled();
      expect(mocks.show).toHaveBeenCalledWith(100, result);
      await controller.status(started.jobId);
      expect(mocks.query).toHaveBeenCalledOnce();
    }
  );

  it('ignores an already-open 404 rather than treating it as a usable legacy application', async () => {
    mocks.query.mockResolvedValue([{ id: 7, title: '404 Not Found' }]);
    expect(await findAlibabaLegacyApplicationTab()).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('preserves a usable TOP flow without borrowing IOP Callback or permissions', async () => {
    mocks.query.mockResolvedValue([{ id: 7, title: 'Legacy application' }]);
    const controller = new ExtensionAlibabaCredentialAcquisitionController();
    const started = await controller.start(null);
    if (started.status !== 'running') throw new Error('Missing fixture task');
    expect(await controller.status(started.jobId)).toMatchObject({
      status: 'callback-confirmation-required',
      currentUrl: fixtures.top.callbackUrl,
      requestedUrl: fixtures.top.callbackUrl
    });
    expect(mocks.legacy).toHaveBeenCalledWith(7);
    expect(mocks.secret).not.toHaveBeenCalled();
    await controller.cancel(started.jobId);
    expect(mocks.close).not.toHaveBeenCalledWith(expect.arrayContaining([7]));
  });

  it('never substitutes the IOP Callback when an existing TOP app has no registered Callback', async () => {
    mocks.query.mockResolvedValue([{ id: 7, title: 'Legacy application' }]);
    mocks.legacy.mockResolvedValue([{ ...legacy, callbackUrl: null }]);
    const controller = new ExtensionAlibabaCredentialAcquisitionController();
    const started = await controller.start(null);
    if (started.status !== 'running') throw new Error('Missing fixture task');
    expect(await controller.status(started.jobId)).toMatchObject({
      status: 'failed',
      error: { code: 'CALLBACK_INVALID' }
    });
    expect(mocks.secret).not.toHaveBeenCalled();
  });

  it('stops after bounded legacy checks without falling back to the IOP application', async () => {
    mocks.query.mockResolvedValue([{ id: 7, title: 'Legacy application' }]);
    mocks.legacy.mockResolvedValue([]);
    const controller = new ExtensionAlibabaCredentialAcquisitionController();
    const started = await controller.start(null);
    if (started.status !== 'running') throw new Error('Missing fixture task');
    for (let index = 0; index < 10; index += 1) await controller.status(started.jobId);
    expect(await controller.status(started.jobId)).toMatchObject({
      status: 'failed',
      error: { code: 'TOP_APPLICATION_REQUIRED' }
    });
    expect(mocks.legacy).toHaveBeenCalledTimes(10);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.secret).not.toHaveBeenCalled();
  });
});
