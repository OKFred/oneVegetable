import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PageDriver from '../lib/alibaba-credential-page-driver';
import {
  ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY,
  createAlibabaDeveloperOnboardingSnapshot
} from '@one-vegetable/core';
const mocks = vi.hoisted(() => ({
  stored: {},
  inspect: vi.fn(),
  show: vi.fn(),
  hide: vi.fn()
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'guide-test-extension' },
    tabs: { onUpdated: { addListener: vi.fn() }, query: () => Promise.resolve([{ id: 7 }]) },
    storage: {
      local: {
        get: () => Promise.resolve({ ...mocks.stored }),
        set: (values: Record<string, unknown>) => {
          Object.assign(mocks.stored, values);
          return Promise.resolve();
        },
        remove: (key: string) => {
          Reflect.deleteProperty(mocks.stored, key);
          return Promise.resolve();
        }
      }
    }
  }
}));
vi.mock('../lib/alibaba-credential-page-driver', async (original) => ({
  ...(await original<typeof PageDriver>()),
  inspectAlibabaApplicationPageState: mocks.inspect,
  showAlibabaDeveloperGuide: mocks.show,
  hideAlibabaDeveloperGuide: mocks.hide
}));
import { ExtensionAlibabaCredentialAcquisitionController } from '../lib/alibaba-credential-acquisition';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stored = {
    [ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY]: createAlibabaDeveloperOnboardingSnapshot({
      status: 'prerequisite-required',
      reasonCode: 'developer-registration-rejected',
      checkedAtUtc: Date.now() - 1_000
    })
  };
  mocks.show.mockResolvedValue(undefined);
  mocks.hide.mockResolvedValue(undefined);
});
describe('prerequisite cache revalidation', () => {
  it('clears a stale rejection only when current approval or an actual app is confirmed', async () => {
    mocks.inspect.mockResolvedValue({ kind: 'registration-approved' });
    const controller = new ExtensionAlibabaCredentialAcquisitionController();
    expect(await controller.readPrerequisite()).toBeNull();
    expect(mocks.stored).not.toHaveProperty(ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY);
    expect(mocks.hide).toHaveBeenCalledWith(7);
    expect(mocks.show).not.toHaveBeenCalled();
  });
  it('does not infer approval from navigation while a frame is loading', async () => {
    mocks.inspect.mockResolvedValue({ kind: 'navigation-ready' });
    const controller = new ExtensionAlibabaCredentialAcquisitionController();
    expect(await controller.readPrerequisite()).toMatchObject({
      reasonCode: 'developer-registration-rejected'
    });
    expect(mocks.stored).toHaveProperty(ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY);
  });
  it('updates the current reason and only trusts the exact guide tab, origin and extension', async () => {
    mocks.inspect.mockResolvedValue({
      kind: 'prerequisite',
      reasonCode: 'application-required',
      registration: null
    });
    const controller = new ExtensionAlibabaCredentialAcquisitionController();
    expect(await controller.readPrerequisite()).toMatchObject({ reasonCode: 'application-required' });
    const sender = {
      id: 'guide-test-extension',
      tab: { id: 7 },
      url: 'https://i.alibaba.com/explore/open-api'
    };
    expect(controller.isGuideSender(sender)).toBe(true);
    expect(controller.isGuideSender({ ...sender, tab: { id: 8 } })).toBe(false);
    expect(controller.isGuideSender({ ...sender, id: 'another-extension' })).toBe(false);
    expect(controller.isGuideSender({ ...sender, url: 'https://untrusted.example/profile' })).toBe(false);
    expect(controller.isGuideSender({ ...sender, url: 'https://i.alibaba.com/other' })).toBe(false);
  });
});
