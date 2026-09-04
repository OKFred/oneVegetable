// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import AlibabaIndependentNotice from '../src/components/AlibabaIndependentNotice.vue';
import { uiI18n } from '../src/i18n';

afterEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
});

describe('AlibabaIndependentNotice', () => {
  it('states the independent relationship and links to official platform rules in Chinese', () => {
    uiI18n.global.locale.value = 'zh-CN';
    const wrapper = mount(AlibabaIndependentNotice);

    expect(wrapper.text()).toContain('不存在官方隶属、合作、认可或背书关系');
    const link = wrapper.get('a');
    expect(link.attributes('href')).toBe('https://rulechannel.alibaba.com/icbu');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
  });

  it('provides the same disclosure in English', () => {
    uiI18n.global.locale.value = 'en-US';
    const wrapper = mount(AlibabaIndependentNotice);

    expect(wrapper.text()).toContain('not affiliated with, endorsed by, sponsored by');
    expect(wrapper.text()).toContain('Read Alibaba.com platform rules');
  });
});
