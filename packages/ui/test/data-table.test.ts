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
  it('keeps every column title on one line and allows horizontal scrolling', () => {
    const columns: DataColumn<Row>[] = [{ accessorKey: 'name', header: '很长的表格列标题' }];
    const Host = defineComponent(() => () => h(DataTable<Row>, { columns, data: [{ name: 'value' }] }));
    const wrapper = mount(Host);

    expect(wrapper.get('th').classes()).toContain('whitespace-nowrap');
    expect(wrapper.get('table').element.parentElement?.classList.contains('overflow-x-auto')).toBe(true);
  });
});
