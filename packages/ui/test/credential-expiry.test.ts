// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CredentialExpiryNotice from '../src/components/CredentialExpiryNotice.vue';
import { credentialExpiryState, credentialExpiryTone } from '../src/lib/credential-expiry';
import { uiI18n } from '../src/i18n';
afterEach(() => {
  vi.useRealTimers();
  uiI18n.global.locale.value = 'zh-CN';
});
describe('authorization expiry reminders', () => {
  it.each([
    [1, 'normal'],
    [0.5, 'normal'],
    [0.49, 'warning'],
    [0.25, 'warning'],
    [0.24, 'danger'],
    [0, 'danger'],
    [-0.01, 'danger']
  ] as const)('colors %s of the current token lifetime as %s', (fraction, tone) => {
    const captured = 1_800_000_000_000;
    const lifetime = 100 * 86_400_000;
    expect(credentialExpiryTone(captured + lifetime, captured, captured + lifetime * (1 - fraction))).toBe(
      tone
    );
  });
  it('keeps old/invalid baselines honest, preserves the seven-day fallback and colors expired tokens red', () => {
    const now = 1_800_000_000_000;
    for (const captured of [undefined, null, NaN, -1, Infinity, now + 1, now + 10 * 86_400_000]) {
      expect(credentialExpiryTone(now + 10 * 86_400_000, captured, now)).toBe('normal');
      expect(credentialExpiryTone(now + 86_400_000, captured, now)).toBe('warning');
      expect(credentialExpiryTone(now, captured, now)).toBe('danger');
    }
    expect(credentialExpiryTone(null, now, now)).toBe('normal');
    expect(credentialExpiryTone(now + 1000, now, NaN)).toBe('normal');
  });
  it('distinguishes unknown, expired, seven-day boundary and valid records', () => {
    const now = 1_800_000_000_000;
    for (const value of [undefined, null, NaN, -1, Infinity])
      expect(credentialExpiryState(value, now).status).toBe('unknown');
    expect(credentialExpiryState(now, now).status).toBe('expired');
    expect(credentialExpiryState(now + 7 * 86_400_000, now)).toMatchObject({
      status: 'expiring',
      count: 7,
      unit: 'days'
    });
    expect(credentialExpiryState(now + 8 * 86_400_000, now).status).toBe('valid');
  });
  it('updates remaining time locally, distinguishes invalid authorization and cleans up its clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const wrapper = mount(CredentialExpiryNotice, {
      props: { expires: Date.now() + 60_000, extension: true }
    });
    expect(wrapper.text()).toContain('剩余约 1 分钟');
    expect(wrapper.text()).toContain('插件不会自动续期');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wrapper.text()).toContain('授权已到期');
    await wrapper.setProps({ expires: Date.now() + 86_400_000, invalid: true });
    expect(wrapper.text()).toContain('授权已失效或刷新失败');
    expect(wrapper.text()).not.toContain('剩余约');
    uiI18n.global.locale.value = 'en-US';
    await nextTick();
    expect(wrapper.text()).toContain('Authorization invalid');
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never calls unknown expiry permanent or displays a fabricated countdown', () => {
    const wrapper = mount(CredentialExpiryNotice, { props: { expires: null } });
    expect(wrapper.text()).toContain('未知，不代表永久有效');
    expect(wrapper.text()).not.toContain('剩余约');
    wrapper.unmount();
  });
});
