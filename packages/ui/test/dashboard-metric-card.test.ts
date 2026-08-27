// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardMetricCard from '../src/components/DashboardMetricCard.vue';

describe('DashboardMetricCard', () => {
  it('distinguishes a confirmed zero from unavailable data', () => {
    const wrapper = mount(DashboardMetricCard, {
      props: {
        title: '订单',
        value: 0,
        status: { state: 'available', source: 'gateway', reasonCode: null },
        description: '订单总数',
        gatewaySourceLabel: 'Alibaba 实时数据'
      }
    });

    expect(wrapper.text()).toContain('0');
    expect(wrapper.text()).toContain('已确认为 0');
    expect(wrapper.text()).not.toContain('接口请求失败');
  });

  it('shows permission and stable reason codes without inventing a zero', () => {
    const wrapper = mount(DashboardMetricCard, {
      props: {
        title: 'RFQ',
        value: null,
        status: {
          state: 'permission-denied',
          source: 'gateway',
          reasonCode: 'isv.permission-api-package-limit'
        },
        description: '询价总数',
        gatewaySourceLabel: 'Alibaba 实时数据'
      }
    });

    expect(wrapper.text()).toContain('—');
    expect(wrapper.text()).toContain('当前账号无权限');
    expect(wrapper.text()).toContain('isv.permission-api-package-limit');
  });

  it('explains a total that the provider did not return', () => {
    const wrapper = mount(DashboardMetricCard, {
      props: {
        title: '图库',
        value: null,
        status: { state: 'unknown', source: 'gateway', reasonCode: 'TOTAL_NOT_PROVIDED' },
        description: '素材总数',
        gatewaySourceLabel: '文档 Replay'
      }
    });

    expect(wrapper.text()).toContain('上游未提供可确认总数');
  });
});
