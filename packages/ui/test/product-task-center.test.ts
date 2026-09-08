// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ProductMutationJob } from '@one-vegetable/core';

import ProductTaskCenter from '../src/components/ProductTaskCenter.vue';
import { uiI18n } from '../src/i18n';

const NOW = Date.UTC(2026, 8, 8);

describe('ProductTaskCenter', () => {
  beforeEach(() => {
    uiI18n.global.locale.value = 'zh-CN';
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
    expect(wrapper.text()).toContain('等待平台回读');
    expect(wrapper.get('a').attributes('href')).toContain('alibaba.com/product-detail/');

    const checkButton = wrapper.findAll('button').find((button) => button.text().includes('查询平台状态'));
    if (!checkButton) throw new Error('Missing task readback button');
    await checkButton.trigger('click');
    expect(wrapper.emitted('refresh-job')?.[0]).toEqual([job]);
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
