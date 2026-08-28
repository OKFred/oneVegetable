// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import {
  loadProductBatchPublishItems,
  upsertProductBatchPublishItem
} from '../src/lib/product-batch-publish';
import { provideServices } from '../src/lib/services';
import ProductsView from '../src/views/ProductsView.vue';

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../mock/data/product-batch-publish.json'), 'utf8')
) as { validXml: string };

describe('ProductsView batch publishing', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.history.replaceState(null, '', '#/products/batch-publisher');
  });

  it('submits selected queue items as platform drafts and persists each result', async () => {
    const now = Date.now();
    queue('queue-1', 'First batch product', now);
    queue('queue-2', 'Second batch product', now + 1);
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);

    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('批量发品队列');
      expect(wrapper.text()).toContain('First batch product');
      expect(wrapper.text()).toContain('Second batch product');
    });
    await wrapper.get('input[aria-label="选择全部待发布商品"]').setValue(true);
    const run = wrapper.findAll('button').find((button) => button.text().includes('开始保存草稿'));
    if (!run) throw new Error('Missing batch draft action');
    await run.trigger('click');

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('批量任务完成：成功 2，失败 0，阻断 0，停止 0');
    });
    expect(
      request.mock.calls
        .filter(([operation]) => operation === 'saveProductDraft')
        .map(([, payload]) => payload)
    ).toEqual([
      expect.objectContaining({ categoryId: 201712702, language: 'en_US' }),
      expect.objectContaining({ categoryId: 201712702, language: 'en_US' })
    ]);
    expect(loadProductBatchPublishItems(localStorage).map((item) => item.status)).toEqual([
      'draft-saved',
      'draft-saved'
    ]);
    wrapper.unmount();
  });
});

function queue(id: string, title: string, now: number): void {
  upsertProductBatchPublishItem(
    localStorage,
    {
      title,
      categoryId: '201712702',
      language: 'en_US',
      market: 'wholesale',
      xml: fixture.validXml.replace('Batch portable power station', title)
    },
    { id, now }
  );
}

function mountView(gateway: MockGatewayClient) {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: {
          get: (operations) =>
            Promise.resolve({
              items: operations.map((operation) => ({
                operation,
                allowed: true,
                reasonCode: 'TEST_ALLOWED'
              }))
            })
        },
        mode: 'mock'
      });
      return () => h(ProductsView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
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
