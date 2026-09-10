// @vitest-environment jsdom
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import DataTable from '../src/components/DataTable.vue';
import ColumnSettings from '../src/components/ColumnSettings.vue';
import {
  clearColumnPreferences,
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
    expect(wrapper.findAll('th')).toHaveLength(3);
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
