// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DataTable from '../src/components/DataTable.vue';
import type { DataColumn } from '../src/lib/table';

interface Row {
  name: string;
}

describe('DataTable', () => {
  it('keeps every column title on one line and constrains both table axes', () => {
    const columns: DataColumn<Row>[] = [{ accessorKey: 'name', header: '很长的表格列标题' }];
    const Host = defineComponent(
      () => () =>
        h(DataTable<Row>, {
          columns,
          data: [{ name: 'value' }],
          maxHeight: '320px',
          minWidth: '960px'
        })
    );
    const wrapper = mount(Host);
    const viewport = wrapper.get('table').element.parentElement;

    expect(wrapper.get('th').classes()).toContain('whitespace-nowrap');
    expect(wrapper.get('thead').classes()).toContain('sticky');
    expect(viewport?.classList.contains('overflow-auto')).toBe(true);
    expect(viewport?.style.maxHeight).toBe('320px');
    expect(wrapper.get('table').attributes('style')).toContain('min-width: 960px');
  });
});
