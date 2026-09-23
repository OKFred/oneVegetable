// @vitest-environment jsdom
import { h } from 'vue';
import { flushPromises, mount, DOMWrapper } from '@vue/test-utils';
import { Search } from '@lucide/vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ListActionButton from '../src/components/ListActionButton.vue';
import ListViewToggle from '../src/components/ListViewToggle.vue';
import RowActionsMenu from '../src/components/RowActionsMenu.vue';
import Button from '../src/components/ui/Button.vue';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('shared list button presentation', () => {
  it('uses the same neutral size, icon and button semantics, forwarding disabled and focus', async () => {
    const click = vi.fn();
    const wrapper = mount(ListActionButton, {
      props: { icon: Search, type: 'submit' },
      attrs: { onClick: click, 'aria-label': 'Search records' },
      slots: { default: 'Search' },
      attachTo: document.body
    });
    const button = wrapper.get('button');
    expect(button.classes()).toEqual(expect.arrayContaining(['h-9', 'border', 'bg-background']));
    expect(button.classes()).not.toContain('bg-primary');
    expect(button.attributes('type')).toBe('submit');
    expect(button.attributes('aria-label')).toBe('Search records');
    expect(button.get('svg').attributes('aria-hidden')).toBe('true');
    expect(button.get('svg').classes()).toContain('size-4');
    await button.trigger('click');
    expect(click).toHaveBeenCalledOnce();
    const exposed = wrapper.vm as unknown as { focus: () => void };
    exposed.focus();
    expect(document.activeElement).toBe(button.element);
    await wrapper.setProps({ disabled: true });
    await button.trigger('click');
    expect(click).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('keeps both view selectors neutral and exposes the selected state', async () => {
    const wrapper = mount(ListViewToggle, {
      props: { modelValue: 'cards', label: 'Display mode', cardsLabel: 'Cards', listLabel: 'List' }
    });
    const [cards, list] = wrapper.findAll('button');
    expect(cards?.attributes('aria-pressed')).toBe('true');
    expect(cards?.classes()).toContain('bg-secondary');
    expect(list?.attributes('aria-pressed')).toBe('false');
    expect(wrapper.findAll('svg[aria-hidden="true"]')).toHaveLength(2);
    await list?.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['list']]);
    wrapper.unmount();
  });

  it('normalizes menu actions but keeps the trigger compact and destructive actions identifiable', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    const click = vi.fn();
    const wrapper = mount(RowActionsMenu, {
      props: { label: 'Record actions' },
      slots: {
        default: () => [
          h(Button, { variant: 'default', onClick: click }, () => 'Edit'),
          h(Button, { variant: 'outline', disabled: true }, () => 'Unavailable'),
          h(Button, { variant: 'destructive' }, () => 'Delete')
        ]
      },
      attachTo: document.body
    });
    const trigger = wrapper.get('button');
    expect(trigger.classes()).toContain('size-8');
    expect(trigger.classes()).not.toContain('w-full');
    await trigger.trigger('click');
    await flushPromises();
    const body = new DOMWrapper(document.body);
    const [edit, disabled, remove] = body.findAll('[data-row-actions] button');
    expect(edit?.classes()).toEqual(
      expect.arrayContaining(['bg-transparent', 'border-0', 'text-popover-foreground'])
    );
    expect(edit?.classes()).not.toContain('bg-primary');
    expect(disabled?.attributes('disabled')).toBeDefined();
    expect(remove?.classes()).toContain('text-destructive');
    expect(remove?.classes()).not.toContain('bg-destructive');
    await edit?.trigger('click');
    await flushPromises();
    expect(click).toHaveBeenCalledOnce();
    expect(body.find('[data-row-actions]').exists()).toBe(false);
    wrapper.unmount();
  });
});
