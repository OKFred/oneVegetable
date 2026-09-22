// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductVisibleRegion from '../src/components/ProductVisibleRegion.vue';

afterEach(() => vi.unstubAllGlobals());
describe('product read visibility', () => {
  it('requires intersection and foreground visibility and releases its observer', async () => {
    let callback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    const observer = { observe: vi.fn(), disconnect };
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(value: IntersectionObserverCallback) {
          callback = value;
        }
        observe = observer.observe;
        disconnect = disconnect;
      }
    );
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const wrapper = mount(ProductVisibleRegion);
    expect(wrapper.emitted('visible')).toBeUndefined();
    callback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver
    );
    expect(wrapper.emitted('visible')?.at(-1)).toEqual([true]);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(wrapper.emitted('visible')?.at(-1)).toEqual([false]);
    await wrapper.setProps({ active: false });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(wrapper.emitted('visible')?.at(-1)).toEqual([false]);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('does not eagerly request details when the observer is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const wrapper = mount(ProductVisibleRegion);
    expect(wrapper.emitted('visible')).toBeUndefined();
    wrapper.unmount();
  });
});
