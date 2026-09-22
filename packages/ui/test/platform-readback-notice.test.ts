// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import PlatformReadbackNotice from '../src/components/PlatformReadbackNotice.vue';
import { productReadbackNotice } from '../src/lib/platform-readback-notice';
import { uiI18n } from '../src/i18n';

afterEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
  document.documentElement.classList.remove('dark');
});

describe('platform synchronization guidance', () => {
  it('only labels acknowledged job states as accepted, not intents or errors', () => {
    for (const status of ['auditing', 'verifying', 'recovering'] as const)
      expect(productReadbackNotice(status)).toBe('accepted');
    for (const status of ['submitted', 'recovery-required'] as const)
      expect(productReadbackNotice(status)).toBe('unconfirmed');
    for (const status of ['failed', 'verified', 'recovered'] as const)
      expect(productReadbackNotice(status)).toBeNull();
  });
  it('offers read-only inventory advice without claiming a completed write or fixed delay', () => {
    uiI18n.global.locale.value = 'zh-CN';
    const wrapper = mount(PlatformReadbackNotice, { props: { kind: 'inventory' } });
    expect(wrapper.get('aside').attributes('role')).toBe('note');
    expect(wrapper.text()).toContain('暂时仍是旧值');
    expect(wrapper.text()).toContain('不要因此重复增减库存');
    expect(wrapper.text()).not.toMatch(/已受理|55|一定|保证/);
    expect(wrapper.findAll('button')).toHaveLength(0);
    wrapper.unmount();
  });
  it('reacts to state and locale changes and stays readable with semantic dark colors', async () => {
    uiI18n.global.locale.value = 'zh-CN';
    document.documentElement.classList.add('dark');
    const wrapper = mount(PlatformReadbackNotice, { props: { kind: 'accepted' } });
    expect(wrapper.text()).toContain('尚未确认最终结果');
    expect(wrapper.get('aside').attributes('role')).toBe('status');
    expect(wrapper.get('aside').classes()).toContain('text-foreground');
    uiI18n.global.locale.value = 'en-US';
    await nextTick();
    expect(wrapper.text()).toContain('Do not submit again');
    await wrapper.setProps({ kind: 'unconfirmed' });
    expect(wrapper.text()).toContain('or an error');
    expect(wrapper.text()).not.toContain('platform accepted');
    expect(wrapper.text()).toContain('requestId');
    await wrapper.setProps({ kind: null });
    expect(wrapper.find('aside').exists()).toBe(false);
    wrapper.unmount();
  });
});
