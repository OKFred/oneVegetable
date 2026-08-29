// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import QueryState from '../src/components/QueryState.vue';

describe('QueryState', () => {
  it('offers an explicit retry action when requested', async () => {
    const wrapper = mount(QueryState, {
      props: { error: new Error('加载失败'), retryable: true },
      global: { stubs: { ErrorNotice: { template: '<div data-testid="error-notice" />' } } }
    });

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});
