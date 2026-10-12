// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import GatewayProtocolNotice from '../src/components/settings/GatewayProtocolNotice.vue';
import { uiI18n } from '../src/i18n';

afterEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
});
describe('protocol guidance', () => {
  it.each(['zh-CN', 'en-US'] as const)(
    'names only the three verified Schema writes and keeps other methods gated (%s)',
    (locale) => {
      uiI18n.global.locale.value = locale;
      const wrapper = mount(GatewayProtocolNotice, { props: { protocol: 'iop' } });
      expect(wrapper.text()).toContain(
        locale === 'zh-CN'
          ? '已验收的 Schema 发布、存草稿、更新'
          : 'verified Schema publish, draft and update'
      );
      expect(wrapper.text()).toContain(
        locale === 'zh-CN' ? '其他方法逐项启用' : 'Other methods open individually'
      );
      expect(wrapper.text()).toContain(locale === 'zh-CN' ? '不回退 TOP' : 'no TOP fallback');
      expect(wrapper.text()).not.toMatch(/不支持订单|not orders|compatible reads/u);
      wrapper.unmount();
    }
  );
  it.each([undefined, 'top'] as const)('does not infer IOP from legacy/default TOP (%s)', (protocol) => {
    const wrapper =
      protocol === undefined
        ? mount(GatewayProtocolNotice)
        : mount(GatewayProtocolNotice, { props: { protocol } });
    expect(wrapper.find('[data-testid="iop-protocol-notice"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
