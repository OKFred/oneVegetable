// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '@one-vegetable/core/version';

import ReleaseNotesView from '../src/views/ReleaseNotesView.vue';

describe('ReleaseNotesView', () => {
  it('renders the bundled current version and historical changes', () => {
    const wrapper = mount(ReleaseNotesView);

    expect(wrapper.get('h1').text()).toBe('版本更新');
    expect(wrapper.text()).toContain(`v${APP_VERSION}`);
    expect(wrapper.text()).toContain('开放平台授权新手引导');
    expect(wrapper.text()).toContain('商店与隐私披露修复');
    expect(wrapper.text()).toContain('双语工作台与社交发布');
    expect(wrapper.text()).toContain('开放平台凭据向导');
    expect(wrapper.text()).toContain('商品详情模板与弹窗稳定性');
    expect(wrapper.text()).toContain('MV3 工程化版本基线');
    expect(wrapper.text()).toContain('2026-09-04');
    expect(wrapper.text()).toContain('2026-09-03');
    expect(wrapper.text()).toContain('2026-09-02');
    expect(wrapper.text()).toContain('2026-08-31');
    expect(wrapper.text()).not.toContain('2026年');
    const releases = wrapper.findAll('[aria-label="正式版本更新记录"] > li');
    expect(releases).toHaveLength(6);
    expect(releases[0]?.text()).toContain('v2.3.0 · 开放平台授权新手引导');
  });

  it('links to GitHub without requiring a runtime API client', () => {
    const wrapper = mount(ReleaseNotesView);
    const links = wrapper.findAll('a');

    expect(links.some((link) => link.attributes('href')?.endsWith('/releases'))).toBe(true);
    expect(
      links.every(
        (link) => link.attributes('target') === '_blank' && link.attributes('rel') === 'noopener noreferrer'
      )
    ).toBe(true);
  });
});
