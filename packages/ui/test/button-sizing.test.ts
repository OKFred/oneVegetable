// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { h, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { KeyRound, LoaderCircle } from '@lucide/vue';
import Button from '../src/components/ui/Button.vue';
import { buttonVariants } from '../src/components/ui/button-styles';

describe('shared action sizing', () => {
  it('shares default dimensions with link and file triggers without forcing equal widths', () => {
    const wrapper = mount({
      render: () =>
        h('div', [
          h(Button, { variant: 'outline' }, () => 'Import authorization JSON'),
          h('a', { class: buttonVariants({ variant: 'outline' }), href: '#settings' }, 'Open'),
          h('label', { class: buttonVariants({ variant: 'outline' }) }, [
            'Import',
            h('input', { type: 'file', class: 'sr-only' })
          ])
        ])
    });
    for (const trigger of wrapper.findAll('button, a, label')) {
      expect(trigger.classes()).toEqual(
        expect.arrayContaining([
          'h-9',
          'text-sm',
          'px-4',
          'py-2',
          'rounded-md',
          'items-center',
          'shrink-0',
          '[&_svg]:shrink-0'
        ])
      );
      expect(trigger.classes()).not.toContain('w-full');
      expect(trigger.classes()).not.toContain('flex-1');
    }
    wrapper.unmount();
  });

  it('preserves compact and icon-only dimensions when explicitly requested', () => {
    for (const [size, expected] of [
      ['sm', 'h-8'],
      ['icon', 'w-9']
    ] as const) {
      const wrapper = mount(Button, { props: { size }, slots: { default: () => h(KeyRound) } });
      expect(wrapper.classes()).toContain(expected);
      if (size === 'sm') {
        expect(wrapper.classes()).toContain('text-xs');
        expect(wrapper.classes()).not.toContain('h-9');
      }
      wrapper.unmount();
    }
  });

  it('keeps sizing and event/disabled semantics when an icon becomes a spinner', async () => {
    const click = vi.fn();
    const disabled = ref(false);
    const wrapper = mount({
      setup: () => () =>
        h(Button, { variant: 'outline', disabled: disabled.value, onClick: click }, () => [
          h(LoaderCircle, { class: 'size-4 animate-spin' }),
          'Test connection'
        ])
    });
    await wrapper.trigger('click');
    expect(click).toHaveBeenCalledOnce();
    const classes = wrapper.classes();
    disabled.value = true;
    await nextTick();
    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.classes()).toEqual(classes);
    expect(wrapper.get('svg').classes()).toEqual(expect.arrayContaining(['size-4', 'animate-spin']));
    await wrapper.trigger('click');
    expect(click).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
