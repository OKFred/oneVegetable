// @vitest-environment jsdom
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import DataTable from '../src/components/DataTable.vue';
import ColumnSettings from '../src/components/ColumnSettings.vue';
import {
  clearColumnPreferences,
  normalizeColumnPreference,
  parseColumnPreference,
  useColumnPreferences
} from '../src/lib/column-preferences';
import type { DataColumn } from '../src/lib/table';

describe('column preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it('rejects damaged storage and keeps locked columns while discarding obsolete IDs', () => {
    expect(parseColumnPreference('{')).toBeNull();
    expect(parseColumnPreference('{"version":1,"visible":[1]}')).toBeNull();
    localStorage.setItem('one-vegetable:columns:v1:test', '{"version":1,"visible":["removed"]}');
    const state = useColumnPreferences(
      'test',
      ref([
        { id: 'id', label: 'ID', locked: true, defaultVisible: true },
        { id: 'extra', label: 'Extra', locked: false, defaultVisible: false }
      ])
    );
    expect(state.visible.value).toEqual(['id']);
    state.toggle('extra');
    expect(state.visible.value).toEqual(['id', 'extra']);
    state.toggle('id');
    expect(state.visible.value).toContain('id');
    clearColumnPreferences();
    expect(localStorage.length).toBe(0);
  });
  it('reactively changes table columns, keeps labels reactive, and persists only IDs', async () => {
    const english = ref(false);
    const columns = computed<DataColumn<{ id: string }>[]>(() => [
      { id: 'select', header: 'Select', cell: () => 'check', meta: { sticky: 'left', width: '64px' } },
      {
        id: 'image',
        header: 'Image',
        cell: () => 'image',
        meta: { sticky: 'left', width: '88px', stickyOffset: '64px' }
      },
      { accessorKey: 'id', header: english.value ? 'Identifier' : 'ID' },
      { id: 'extra', header: 'Extra', cell: () => 'optional' }
    ]);
    const Host = defineComponent(
      () => () =>
        h(DataTable<{ id: string }>, {
          columns: columns.value,
          data: [{ id: 'one' }],
          columnSettingsKey: 'example',
          lockedColumns: ['select', 'id'],
          hiddenColumns: ['extra']
        })
    );
    const wrapper = mount(Host);
    const settings = wrapper.getComponent(ColumnSettings);
    expect(wrapper.findAll('th')).toHaveLength(4);
    (settings.vm as { $emit: (event: 'toggle', id: string) => void }).$emit('toggle', 'image');
    (settings.vm as { $emit: (event: 'toggle', id: string) => void }).$emit('toggle', 'extra');
    await nextTick();
    expect(wrapper.get('table').text()).not.toContain('Image');
    expect(wrapper.get('table').text()).toContain('optional');
    expect(wrapper.get('td').attributes('style')).toContain('left: 0px');
    english.value = true;
    await nextTick();
    expect(wrapper.get('table').text()).toContain('Identifier');
    wrapper.unmount();
    const restored = mount(Host);
    expect(restored.get('table').text()).toContain('optional');
    (restored.getComponent(ColumnSettings).vm as { $emit: (event: 'reset') => void }).$emit('reset');
    await nextTick();
    expect(restored.get('table').text()).toContain('Image');
    expect(restored.get('table').text()).not.toContain('optional');
    restored.unmount();
  });
});

describe('column preference V2', () => {
  const options = [
    { id: 'select', label: 'Select', locked: true, defaultVisible: true },
    { id: 'name', label: 'Name', locked: false, defaultVisible: true },
    { id: 'extra', label: 'Extra', locked: false, defaultVisible: false },
    { id: 'actions', label: 'Actions', locked: true, defaultVisible: true }
  ];
  beforeEach(() => {
    localStorage.clear();
  });
  it('migrates V1 once without retaining labels or stale ids', () => {
    localStorage.setItem(
      'one-vegetable:columns:v1:migration',
      JSON.stringify({ version: 1, visible: ['name', 'gone'] })
    );
    const state = useColumnPreferences('migration', ref(options));
    expect(state.visible.value).toEqual(['select', 'name', 'actions']);
    expect(localStorage.getItem('one-vegetable:columns:v1:migration')).toBeNull();
    expect(JSON.parse(localStorage.getItem('one-vegetable:columns:v2:migration') ?? '')).toEqual({
      version: 2,
      visible: ['select', 'name', 'actions'],
      order: ['select', 'name', 'extra', 'actions']
    });
  });
  it('selects/deselects every optional column and never moves or hides anchors', () => {
    const state = useColumnPreferences('all', ref(options));
    state.setAll(false);
    expect(state.visible.value).toEqual(['select', 'actions']);
    state.toggle('select');
    state.move('select', 'name');
    state.move('extra', 'actions');
    expect(state.order.value).toEqual(['select', 'name', 'extra', 'actions']);
    state.setAll(true);
    expect(state.visible.value).toEqual(state.order.value);
  });
  it('persists ordering, restores it, and keeps newly introduced columns hidden', () => {
    const state = useColumnPreferences('order', ref(options));
    state.setAll(true);
    state.moveBy('extra', -1);
    expect(state.order.value).toEqual(['select', 'extra', 'name', 'actions']);
    const restored = useColumnPreferences(
      'order',
      ref([...options, { id: 'new', label: 'New', locked: false, defaultVisible: true }])
    );
    expect(restored.visible.value).toEqual(['select', 'extra', 'name', 'actions']);
    restored.reset();
    expect(restored.visible.value).toEqual(['select', 'name', 'new', 'actions']);
  });
  it('discards malformed V2 and sanitizes duplicate/order/obsolete ids', () => {
    expect(parseColumnPreference('{"version":2,"visible":[],"order":[1]}')).toBeNull();
    expect(
      normalizeColumnPreference(
        { version: 2, visible: ['extra', 'gone'], order: ['actions', 'extra', 'extra', 'gone', 'select'] },
        options
      )
    ).toEqual({
      version: 2,
      visible: ['select', 'extra', 'actions'],
      order: ['select', 'extra', 'name', 'actions']
    });
  });
  it('adds page-only tri-state selection to unselectable tables and clears on pagination', async () => {
    const wrapper = mount(DataTable<{ id: string }>, {
      props: {
        columns: [{ accessorKey: 'id', header: 'ID' }],
        data: [{ id: 'one' }, { id: 'two' }],
        columnSettingsKey: 'generic',
        pageSize: 1,
        totalRows: 2
      }
    });
    const rowCheckbox = wrapper.get('tbody input[type=checkbox]');
    await rowCheckbox.setValue(true);
    expect(wrapper.get('thead input').attributes('aria-checked')).toBe('mixed');
    await wrapper.get('thead input').setValue(true);
    expect(wrapper.findAll('tbody input').every((input) => (input.element as HTMLInputElement).checked)).toBe(
      true
    );
    expect(wrapper.emitted('selection-change')?.at(-1)?.[0]).toEqual([{ id: 'one' }, { id: 'two' }]);
    await wrapper.setProps({ page: 2 });
    expect(wrapper.get('thead input').attributes('aria-checked')).toBe('false');
    expect(wrapper.findAll('th').at(-1)?.attributes('style')).toContain('right: 0px');
    wrapper.unmount();
  });
});
