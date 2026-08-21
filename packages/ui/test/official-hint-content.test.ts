// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { collectProductSchemaOfficialHints, parseProductSchemaXml } from '@one-vegetable/core';
import officialHintFixture from '../../../mock/data/product-schema/official-hints.json';

import OfficialHintContent from '../src/components/OfficialHintContent.vue';

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

describe('OfficialHintContent', () => {
  it('keeps rich guidance collapsed until requested and exposes safe official links', async () => {
    const hint = collectProductSchemaOfficialHints(
      parseProductSchemaXml(officialHintFixture.schemaXml).fields
    ).find((candidate) => candidate.rootFieldId === 'productKeywords');
    if (!hint) throw new Error('Missing product keyword hint');
    const wrapper = mount(OfficialHintContent, { props: { hint } });

    expect(wrapper.text()).toContain('请准确填写与商品名称相关的词');
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('&lt;div&gt;');

    const trigger = wrapper.get('button[aria-label^="展开官方提示"]');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    await trigger.trigger('click');

    expect(wrapper.get('a').attributes()).toMatchObject({
      href: 'https://service.alibaba.com/page/knowledge?pageId=127',
      target: '_blank',
      rel: 'nofollow noopener noreferrer'
    });
    expect(wrapper.get('button[aria-label^="收起官方提示"]').attributes('aria-expanded')).toBe('true');
  });

  it('emits an explicit locate action without coupling links to field navigation', async () => {
    const hint = collectProductSchemaOfficialHints(
      parseProductSchemaXml(officialHintFixture.schemaXml).fields
    )[0];
    if (!hint) throw new Error('Missing official hint');
    const wrapper = mount(OfficialHintContent, { props: { hint } });

    await wrapper.get('button[aria-label="定位字段：商品关键词"]').trigger('click');
    expect(wrapper.emitted('locate')).toHaveLength(1);
  });
});
