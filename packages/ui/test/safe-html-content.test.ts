// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';

import SafeHtmlContent from '../src/components/SafeHtmlContent.vue';

describe('SafeHtmlContent', () => {
  it('renders remote field guidance while removing executable content', async () => {
    const wrapper = mount(SafeHtmlContent, {
      props: {
        html: '<div>查看 <a href="https://service.alibaba.com/help">官方说明</a><script>alert(1)</script></div>'
      }
    });
    await nextTick();

    expect(wrapper.text()).toContain('查看 官方说明');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.get('a').attributes('href')).toBe('https://service.alibaba.com/help');
    expect(wrapper.get('a').attributes('rel')).toBe('nofollow noopener noreferrer');
    expect(wrapper.get('a').attributes('target')).toBe('_blank');
  });
});
