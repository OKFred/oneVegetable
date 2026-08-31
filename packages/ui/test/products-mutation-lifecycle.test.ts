// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import ProductsView from '../src/views/ProductsView.vue';

import type { ProductMutationJob, ProductMutationJobClient } from '@one-vegetable/core';

describe('ProductsView product mutation lifecycle', () => {
  beforeEach(() => {
    globalThis.history.replaceState(null, '', '#/products/list');
  });

  it('restores an auditing job, shows its requestId and disables duplicate updates', async () => {
    const job = jobFixture();
    const refresh = vi.fn(() => Promise.resolve({ ...job, revision: 3, lastCheckedTimeUtc: 3 }));
    const productMutationJobs: ProductMutationJobClient = {
      list: vi.fn(() => Promise.resolve({ items: [job], page: 1, pageSize: 20, total: 1 })),
      get: vi.fn(() => Promise.resolve(job)),
      refresh,
      recover: vi.fn(() => Promise.resolve(job))
    };
    const wrapper = mountProductsView(productMutationJobs, 'updateProduct');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power station 1000W');
    });
    const edit = wrapper.findAll('button').find((button) => button.text().includes('编辑商品'));
    if (!edit) throw new Error('Missing edit button');
    await edit.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('平台审核中');
      expect(wrapper.text()).toContain(job.requestId);
    });
    expect(refresh).toHaveBeenCalled();
    await vi.waitFor(
      () => {
        expect(wrapper.text()).not.toContain('正在加载商品编辑功能');
        expect(wrapper.text()).toContain('检查与提交');
      },
      { timeout: 10_000 }
    );
    const reviewStep = wrapper.findAll('button').find((button) => button.text().includes('检查与提交'));
    if (!reviewStep) throw new Error('Missing review step');
    await reviewStep.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('请勿重复提交');
    });
    const update = wrapper.findAll('button').find((button) => button.text().includes('更新商品'));
    expect(update?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('shows durable display jobs and allows explicit original-state recovery', async () => {
    const job = displayJobFixture();
    const recover = vi.fn(() => Promise.resolve({ ...job, status: 'recovering' as const, revision: 4 }));
    const productMutationJobs: ProductMutationJobClient = {
      list: vi.fn(() => Promise.resolve({ items: [job], page: 1, pageSize: 100, total: 1 })),
      get: vi.fn(() => Promise.resolve(job)),
      refresh: vi.fn(() => Promise.resolve(job)),
      recover
    };
    const wrapper = mountProductsView(productMutationJobs, 'updateProductDisplay', 'extension');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('最近上下架任务');
      expect(wrapper.text()).toContain('需要人工恢复');
    });
    const recovery = wrapper.findAll('button').find((button) => button.text().includes('恢复原状态'));
    if (!recovery) throw new Error('Missing display recovery button');
    await recovery.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('确认恢复商品状态');
    });
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent.trim() === '确认继续'
    );
    if (!confirm) throw new Error('Missing recovery confirmation button');
    confirm.click();
    await vi.waitFor(() => {
      expect(recover).toHaveBeenCalledWith(job.id, job.revision);
    });
    wrapper.unmount();
  });

  it('resumes and displays a persisted product creation readback task', async () => {
    const job = creationJobFixture();
    const verified = {
      ...job,
      status: 'verified' as const,
      revision: 3,
      lastCheckedTimeUtc: 3,
      completedTimeUtc: 3,
      reasonCode: 'PRODUCT_PUBLISH_READBACK_MATCHED',
      message: '商品已在列表回读，当前由平台审核中'
    };
    const refresh = vi.fn(() => Promise.resolve(verified));
    const productMutationJobs: ProductMutationJobClient = {
      list: vi.fn(() => Promise.resolve({ items: [job], page: 1, pageSize: 100, total: 1 })),
      get: vi.fn(() => Promise.resolve(job)),
      refresh,
      recover: vi.fn(() => Promise.resolve(job))
    };
    const wrapper = mountProductsView(productMutationJobs, 'publishProduct', 'extension');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power station 1000W');
    });
    const create = wrapper.findAll('button').find((button) => button.text().trim() === '新增');
    if (!create) throw new Error('Missing create product button');
    await create.trigger('click');
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('最近的正式发布任务');
      expect(wrapper.text()).toContain(job.productId);
      expect(wrapper.text()).toContain(job.requestId);
      expect(wrapper.text()).toContain('商品已在列表回读');
    });
    expect(refresh).toHaveBeenCalledWith(job.id, job.revision);
    wrapper.unmount();
  });
});

function mountProductsView(
  productMutationJobs: ProductMutationJobClient,
  allowedOperation: 'publishProduct' | 'updateProduct' | 'updateProductDisplay',
  mode: 'bff' | 'extension' = 'bff'
) {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: {
          get: (operations) =>
            Promise.resolve({
              items: operations.map((operation) => ({
                operation,
                allowed: operation === allowedOperation,
                reasonCode: operation === allowedOperation ? 'TEST_ALLOWED' : 'TEST_DISABLED'
              }))
            })
        },
        productMutationJobs,
        mode
      });
      return () => h(ProductsView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
}

function jobFixture(): ProductMutationJob {
  return {
    id: '2c70921f-f77a-4310-9d4b-091c66d022d0',
    requestId: 'a52678bd-2e7e-4182-a2f1-3558b2fa64a5',
    productId: '10000001',
    operation: 'updateProduct',
    status: 'auditing',
    categoryId: 100009999,
    language: 'en_US',
    payloadFingerprint: 'a'.repeat(64),
    fieldExpectations: [{ fieldId: 'productTitle', fingerprint: 'b'.repeat(64) }],
    encryptedProductId: null,
    targetDisplay: null,
    originalDisplay: null,
    traceId: 'trace-1',
    reasonCode: 'PUB_BIZCHECK_PRODUCT_IN_AUDITING',
    message: '商品仍在平台审核中',
    submittedTimeUtc: 1,
    lastCheckedTimeUtc: 2,
    completedTimeUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 2,
    creatorId: 'admin-1',
    updaterId: 'admin-1',
    revision: 2,
    remark: null
  };
}

function displayJobFixture(): ProductMutationJob {
  return {
    id: '4c3a468b-cd24-477a-855e-65a5dcd78968',
    requestId: '789ab408-ad81-407a-9de9-35163e08e9ff',
    productId: '10000001',
    operation: 'updateProductDisplay',
    status: 'recovery-required',
    categoryId: null,
    language: null,
    payloadFingerprint: 'c'.repeat(64),
    fieldExpectations: [],
    encryptedProductId: 'mock-encrypted-product-1',
    targetDisplay: 'offline',
    originalDisplay: 'online',
    traceId: 'display-trace',
    reasonCode: 'PRODUCT_DISPLAY_READBACK_TIMEOUT',
    message: '平台状态尚未确认',
    submittedTimeUtc: 1,
    lastCheckedTimeUtc: 2,
    completedTimeUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 2,
    creatorId: 'admin-1',
    updaterId: 'admin-1',
    revision: 3,
    remark: null
  };
}

function creationJobFixture(): ProductMutationJob {
  return {
    id: '7e5b0112-947d-4f5e-889a-ed06f4045bf7',
    requestId: '975c76cc-bc6d-4278-b3db-b512c53f0d26',
    productId: '1600000000002',
    operation: 'publishProduct',
    status: 'verifying',
    categoryId: 100009999,
    language: 'en_US',
    payloadFingerprint: 'd'.repeat(64),
    fieldExpectations: [],
    encryptedProductId: null,
    targetDisplay: null,
    originalDisplay: null,
    traceId: 'creation-trace',
    reasonCode: 'ALIBABA_PRODUCT_PUBLISH_ACCEPTED',
    message: '等待商品列表回读',
    submittedTimeUtc: 1,
    lastCheckedTimeUtc: null,
    completedTimeUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 2,
    creatorId: 'extension:local-admin',
    updaterId: 'extension:local-admin',
    revision: 2,
    remark: null
  };
}

function settings() {
  return {
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac' as const
  };
}
