// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseProductTransferJson } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { loadProductBatchPublishItems } from '../src/lib/product-batch-publish';
import { provideServices } from '../src/lib/services';
import ProductsView from '../src/views/ProductsView.vue';

const fixtureJson = readFileSync(
  resolve(import.meta.dirname, '../../../mock/data/product-transfer-v1.json'),
  'utf8'
);
let exportedBlob: Blob | null = null;

describe('ProductsView import and export', () => {
  beforeEach(() => {
    localStorage.clear();
    exportedBlob = null;
    globalThis.history.replaceState(null, '', '#/products/list');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        exportedBlob = blob;
        return 'blob:product-transfer';
      })
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the selected platform product as versioned JSON with rendered Schema', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power station 1000W');
    });

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    const exportButton = wrapper.findAll('button').find((button) => button.text().includes('导出所选'));
    if (!exportButton) throw new Error('Missing product export action');
    await exportButton.trigger('click');
    await vi.waitFor(() => {
      expect(exportedBlob).not.toBeNull();
    });

    const blob = exportedBlob;
    if (!blob) throw new Error('Missing exported product Blob');
    const exported = parseProductTransferJson(await blob.text());
    expect(exported.products).toHaveLength(1);
    expect(exported.products[0]).toMatchObject({
      source: { productId: '10000001', subject: 'Portable solar power station 1000W' },
      categoryId: 100009999,
      language: 'en_US'
    });
    expect(request).toHaveBeenCalledWith(
      'renderProductSchema',
      expect.objectContaining({ productId: '10000001', categoryId: 100009999 })
    );
    expect(wrapper.text()).toContain('已导出 1 个商品的完整 Schema JSON');
    wrapper.unmount();
  });

  it('exports a platform draft through the draft render operation', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Custom recycled cotton canvas tote bag');
    });

    await wrapper.get('input[aria-label="选择 Custom recycled cotton canvas tote bag"]').setValue(true);
    const exportButton = wrapper.findAll('button').find((button) => button.text().includes('导出所选'));
    if (!exportButton) throw new Error('Missing product export action');
    await exportButton.trigger('click');
    await vi.waitFor(() => {
      expect(exportedBlob).not.toBeNull();
    });

    const blob = exportedBlob;
    if (!blob) throw new Error('Missing exported draft Blob');
    const exported = parseProductTransferJson(await blob.text());
    expect(exported.products[0]).toMatchObject({
      source: { productId: '10000002', status: 'draft' },
      categoryId: 100003109
    });
    expect(request).toHaveBeenCalledWith('getProductDraft', {
      productId: '10000002',
      language: 'en_US'
    });
    wrapper.unmount();
  });

  it('imports JSON into the local review queue without platform writes', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await flushPromises();

    const input = wrapper.get('input[aria-label="选择商品 JSON 文件"]');
    const file = new File([fixtureJson], 'products.json', { type: 'application/json' });
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('商品 JSON 已导入本机队列');
    });

    expect(loadProductBatchPublishItems(localStorage)).toMatchObject([
      { id: 'import:10000001:en_US', status: 'queued', title: 'Portable solar power station 1000W' }
    ]);
    expect(wrapper.text()).toContain('批量发品队列');
    expect(request.mock.calls.some(([operation]) => operation === 'publishProduct')).toBe(false);
    expect(request.mock.calls.some(([operation]) => operation === 'saveProductDraft')).toBe(false);
    wrapper.unmount();
  });
});

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
  return mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
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
