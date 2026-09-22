// @vitest-environment jsdom

import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ProductMutationJob } from '@one-vegetable/core';

import ProductTaskCenter from '../src/components/ProductTaskCenter.vue';
import { uiI18n } from '../src/i18n';

const NOW = Date.UTC(2026, 8, 8);

describe('ProductTaskCenter', () => {
  beforeEach(() => {
    localStorage.clear();
    uiI18n.global.locale.value = 'zh-CN';
  });

  it('retains recovery actions in the row menu and applies status filters only on confirmation', async () => {
    const job = {
      ...mutationJob(),
      operation: 'updateProductDisplay' as const,
      status: 'recovery-required' as const
    };
    const wrapper = mount(ProductTaskCenter, {
      props: { jobs: [job], batchItems: [], loading: false, error: null, refreshingJobId: '', detailUrls: {} }
    });
    await wrapper.get('button[aria-label="job-1的操作"]').trigger('click');
    await flushPromises();
    const recover = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent.trim() === '恢复原状态'
    );
    if (!recover) throw new Error('Missing recovery');
    recover.click();
    await flushPromises();
    expect(wrapper.emitted('recover')?.[0]).toEqual([job]);
    const filter = wrapper.findAll('button').find((item) => item.text() === '筛选');
    if (!filter) throw new Error('Missing filter');
    await filter.trigger('click');
    await flushPromises();
    const checkbox = document.querySelector<HTMLInputElement>('[role="dialog"] input[value="verified"]');
    if (!checkbox) throw new Error('Missing status filter');
    checkbox.click();
    await flushPromises();
    expect(wrapper.text()).toContain(job.productId);
    const apply = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (item) => item.textContent.trim() === '应用筛选'
    );
    if (!apply) throw new Error('Missing apply');
    apply.click();
    await flushPromises();
    expect(wrapper.text()).not.toContain(job.productId);
    expect(wrapper.text()).toContain('筛选 · 1');
    wrapper.unmount();
  });

  it('shows durable platform tasks and exposes explicit readback actions', async () => {
    const job = mutationJob();
    const wrapper = mount(ProductTaskCenter, {
      props: {
        jobs: [job],
        batchItems: [],
        loading: false,
        error: null,
        refreshingJobId: '',
        detailUrls: {
          [job.productId]: 'https://www.alibaba.com/product-detail/example_1600000000001.html'
        }
      }
    });

    expect(wrapper.text()).toContain('平台写入任务');
    expect(wrapper.text()).toContain('平台已受理发布，商品列表尚未回读到该商品。');
    expect(wrapper.get('[data-testid="platform-readback-notice"]').text()).toContain('平台已受理');
    expect(wrapper.get('a').attributes('href')).toContain('alibaba.com/product-detail/');

    await wrapper.get('button[aria-label="job-1的操作"]').trigger('click');
    await flushPromises();
    const checkButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent.includes('查询平台状态')
    );
    if (!checkButton) throw new Error('Missing task readback button');
    checkButton.click();
    await flushPromises();
    expect(wrapper.emitted('refresh-job')?.[0]).toEqual([job]);
    await wrapper.setProps({ jobs: [{ ...job, status: 'recovery-required' }] });
    expect(wrapper.get('[data-testid="platform-readback-notice"]').text()).toContain('延迟或异常');
    expect(wrapper.get('[data-testid="platform-readback-notice"]').text()).not.toContain('平台已受理');
    await wrapper.setProps({ jobs: [{ ...job, status: 'failed' }] });
    expect(wrapper.find('[data-testid="platform-readback-notice"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('失败');
    await wrapper.setProps({ jobs: [{ ...job, status: 'verified' }] });
    expect(wrapper.find('[data-testid="platform-readback-notice"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

function mutationJob(): ProductMutationJob {
  return {
    id: 'job-1',
    requestId: '00000000-0000-4000-8000-000000000001',
    productId: '1600000000001',
    operation: 'publishProduct',
    status: 'verifying',
    categoryId: 201712702,
    language: 'en_US',
    payloadFingerprint: 'a'.repeat(64),
    fieldExpectations: [],
    encryptedProductId: null,
    targetDisplay: null,
    originalDisplay: null,
    traceId: 'trace-1',
    reasonCode: 'PRODUCT_PUBLISH_READBACK_PENDING',
    message: '等待平台回读',
    submittedTimeUtc: NOW,
    lastCheckedTimeUtc: NOW,
    completedTimeUtc: null,
    createTimeUtc: NOW,
    updateTimeUtc: NOW,
    creatorId: 'extension:local-admin',
    updaterId: 'extension:local-admin',
    revision: 1,
    remark: null
  };
}
