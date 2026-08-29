// @vitest-environment jsdom

import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DataTable from '../src/components/DataTable.vue';
import type { DataColumn } from '../src/lib/table';

interface Row {
  name: string;
}

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ name: `row-${index + 1}` }));
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

  it('paginates complete client-side data and resets after the data set changes', async () => {
    const columns: DataColumn<Row>[] = [{ accessorKey: 'name', header: '名称' }];
    const data = ref(rows(23));
    const Host = defineComponent(
      () => () =>
        h(DataTable<Row>, {
          columns,
          data: data.value
        })
    );
    const wrapper = mount(Host);

    expect(wrapper.text()).toContain('row-1');
    expect(wrapper.text()).not.toContain('row-11');
    expect(wrapper.text()).toContain('共 23 条');
    expect(wrapper.text()).toContain('第 1 / 3 页');

    await wrapper.get('button[aria-label="下一页"]').trigger('click');
    expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toEqual(
      rows(20)
        .slice(10)
        .map((row) => row.name)
    );

    data.value = rows(3);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('row-1');
    expect(wrapper.text()).toContain('第 1 / 1 页');
  });

  it('emits page changes without slicing an already paginated server response', async () => {
    const columns: DataColumn<Row>[] = [{ accessorKey: 'name', header: '名称' }];
    const wrapper = mount(DataTable<Row>, {
      props: {
        columns,
        data: rows(20),
        page: 2,
        pageSize: 20,
        totalRows: 55
      }
    });

    expect(wrapper.findAll('tbody tr')).toHaveLength(20);
    expect(wrapper.text()).toContain('第 2 / 3 页');
    await wrapper.get('button[aria-label="下一页"]').trigger('click');
    expect(wrapper.emitted('update:page')).toEqual([[3]]);
    await wrapper.get('select[aria-label="每页条数"]').setValue('10');
    expect(wrapper.emitted('update:pageSize')).toEqual([[10]]);
  });

  it('renders additional summary content in the pagination footer', () => {
    const columns: DataColumn<Row>[] = [{ accessorKey: 'name', header: '名称' }];
    const wrapper = mount(DataTable<Row>, {
      props: {
        columns,
        data: rows(3)
      },
      slots: {
        'pagination-summary': () => h('span', { 'data-testid': 'selection-count' }, '已选 2 个')
      }
    });

    const pagination = wrapper.get('nav[aria-label="表格分页"]');
    expect(pagination.get('[data-testid="selection-count"]').text()).toBe('已选 2 个');
  });

  it('pins configured columns with opaque inherited row backgrounds', () => {
    const columns: DataColumn<Row>[] = [
      {
        accessorKey: 'name',
        header: '左侧',
        meta: { sticky: 'left', stickyOffset: '0px', stickyBoundary: true, width: '96px' }
      },
      {
        id: 'actions',
        header: '右侧',
        cell: () => '操作',
        meta: { sticky: 'right', stickyOffset: '0px', stickyBoundary: true, width: '120px' }
      }
    ];
    const wrapper = mount(DataTable<Row>, {
      props: { columns, data: [{ name: 'value' }] }
    });
    const headers = wrapper.findAll('th');
    const cells = wrapper.findAll('tbody td');

    expect(headers[0]?.classes()).toContain('sticky');
    expect((headers[0]?.element as HTMLElement).style.left).toBe('0px');
    expect((headers[0]?.element as HTMLElement).style.width).toBe('96px');
    expect(headers[1]?.classes()).toContain('sticky');
    expect((headers[1]?.element as HTMLElement).style.right).toBe('0px');
    expect(cells[0]?.classes()).toContain('bg-inherit');
    expect(cells[1]?.classes()).toContain('bg-inherit');
    expect(wrapper.get('tbody tr').classes()).toContain('bg-background');
  });
});
