// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import PageDetailActions from '../src/components/PageDetailActions.vue';

describe('automatic visible-column details', () => {
  it('starts once per page, waits for the old batch, and does not restart on progress', async () => {
    const load = vi.fn().mockResolvedValue({ success: 1, failed: 0 });
    const onStop = vi.fn();
    const wrapper = mount(PageDetailActions, {
      props: { busy: false, done: 0, total: 1, count: 1, failed: false, pageKey: 'one', load, onStop }
    });
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ busy: true, pageKey: 'two' });
    expect(load).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ busy: false });
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    await wrapper.setProps({ done: 1 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toBe('');
    wrapper.unmount();
    expect(onStop).toHaveBeenCalledTimes(3);
  });
});
