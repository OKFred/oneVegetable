// @vitest-environment jsdom
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnsavedEditingService,
  installEditingNavigationGuard,
  provideUnsavedEditing,
  useUnsavedEditing
} from '../src/lib/unsaved-editing';
import UnsavedEditingDialog from '../src/components/UnsavedEditingDialog.vue';

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, '', '#/dashboard');
});

describe('unsaved editing', () => {
  it('establishes an explicit loaded baseline and excludes presentation changes', async () => {
    const service = new UnsavedEditingService();
    const value = ref('');
    const locale = ref('zh-CN');
    let editing: ReturnType<typeof useUnsavedEditing> | undefined;
    const Child = defineComponent({
      setup() {
        editing = useUnsavedEditing(() => value.value);
        return () => h('span', locale.value);
      }
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideUnsavedEditing(service);
          return () => h(Child);
        }
      })
    );
    value.value = 'platform data';
    editing?.markClean();
    expect(service.dirty.value).toBe(false);
    locale.value = 'en-US';
    expect(service.dirty.value).toBe(false);
    value.value = 'edited';
    expect(service.dirty.value).toBe(true);
    const action = vi.fn();
    const cancelled = editing?.guard(action);
    expect(service.confirmationOpen.value).toBe(true);
    service.answer(false);
    expect(await cancelled).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(service.dirty.value).toBe(true);
    const accepted = editing?.guard(action);
    service.answer(true);
    expect(await accepted).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(service.dirty.value).toBe(false);
  });

  it('keeps URL and the mounted view unchanged on cancelled hash/back navigation', async () => {
    window.history.replaceState(null, '', '#/products');
    const dirty = ref(true);
    const service = new UnsavedEditingService();
    service.register({
      dirty,
      markClean: () => {
        dirty.value = false;
      }
    });
    const stop = installEditingNavigationGuard(service);
    const render = vi.fn();
    window.addEventListener('hashchange', render);
    window.location.hash = '#/photos';
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(window.location.hash).toBe('#/products');
    expect(render).not.toHaveBeenCalled();
    service.answer(false);
    await flushPromises();
    expect(window.location.hash).toBe('#/products');
    expect(dirty.value).toBe(true);
    window.location.hash = '#/orders';
    await new Promise((resolve) => setTimeout(resolve, 10));
    service.answer(true);
    await flushPromises();
    expect(window.location.hash).toBe('#/orders');
    expect(render).toHaveBeenCalledOnce();
    window.removeEventListener('hashchange', render);
    stop();
    service.dispose();
  });

  it('tracks accepted pushState routes and adds beforeunload only while dirty', () => {
    window.history.replaceState(null, '', '#/products');
    const dirty = ref(false);
    const service = new UnsavedEditingService();
    service.register({
      dirty,
      markClean: () => {
        dirty.value = false;
      }
    });
    const stop = installEditingNavigationGuard(service);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    window.history.pushState(null, '', '#/products/publisher');
    dirty.value = true;
    const changed = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(changed);
    expect(changed.defaultPrevented).toBe(true);
    dirty.value = false;
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
    stop();
    service.dispose();
  });

  it('only one pending navigation can run and the dialog can cancel without discarding', async () => {
    const service = new UnsavedEditingService();
    const dirty = ref(true);
    service.register({
      dirty,
      markClean: () => {
        dirty.value = false;
      }
    });
    const wrapper = mount(UnsavedEditingDialog, { props: { service }, attachTo: document.body });
    const first = service.confirmLeave();
    expect(await service.confirmLeave()).toBe(false);
    await flushPromises();
    const button = [...document.querySelectorAll('button')].find((node) =>
      node.textContent.includes('继续编辑')
    );
    expect(button).toBeDefined();
    button?.click();
    await flushPromises();
    expect(await first).toBe(false);
    expect(dirty.value).toBe(true);
    wrapper.unmount();
    service.dispose();
  });
});
