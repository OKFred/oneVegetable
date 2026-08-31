// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import {
  parseProductTransferArchiveJson,
  parseProductTransferJson,
  type OperationId,
  type RequestOf,
  type ResponseOf
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { loadProductBatchPublishItems } from '../src/lib/product-batch-publish';
import {
  createProductTransferArchive,
  readProductTransferArchive
} from '../src/lib/product-transfer-archive';
import { provideServices } from '../src/lib/services';
import ProductsView from '../src/views/ProductsView.vue';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn() }
}));

const fixtureJson = readFileSync(
  resolve(import.meta.dirname, '../../../mock/data/product-transfer-v1.json'),
  'utf8'
);
const archiveFixtureJson = readFileSync(
  resolve(import.meta.dirname, '../../../mock/data/product-transfer/products-v2.json'),
  'utf8'
);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let exportedBlob: Blob | null = null;

class SecondUploadFailsGateway extends MockGatewayClient {
  uploadCount = 0;

  override request<K extends OperationId>(operation: K, request: RequestOf<K>): Promise<ResponseOf<K>> {
    if (operation === 'uploadPhoto') {
      this.uploadCount += 1;
      if (this.uploadCount === 2) return Promise.reject(new Error('second ZIP image upload failed'));
    }
    return super.request(operation, request);
  }
}

describe('ProductsView import and export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    toolbarButton(wrapper.element as Element, '导出').click();
    await flushPromises();

    const exportDialog = getDialog('导出商品');
    expect(exportDialog.textContent).toContain('已冻结本次导出范围');
    expect(request.mock.calls.some(([operation]) => operation === 'renderProductSchema')).toBe(false);
    expect(exportedBlob).toBeNull();

    button(exportDialog, '导出').click();
    await flushPromises();
    expect(request.mock.calls.some(([operation]) => operation === 'renderProductSchema')).toBe(false);
    expect(exportedBlob).toBeNull();

    button(getDialog('确认导出'), '确认导出').click();
    await vi.waitFor(() => {
      expect(exportedBlob).not.toBeNull();
    });

    const blob = exportedBlob;
    if (!blob) throw new Error('Missing exported product Blob');
    const exportedJson = await blob.text();
    const raw = JSON.parse(exportedJson) as { products: Record<string, unknown>[] };
    expect(raw.products[0]).toHaveProperty('schemaJson');
    expect(raw.products[0]).not.toHaveProperty('schemaXml');
    const exported = parseProductTransferJson(exportedJson);
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
    expect(toast.success).toHaveBeenCalledWith('已导出 1 个商品（JSON，Schema JSON）。');
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
    toolbarButton(wrapper.element as Element, '导出').click();
    await flushPromises();

    const exportDialog = getDialog('导出商品');
    const advancedSettings = exportDialog.querySelector('details');
    if (!(advancedSettings instanceof HTMLDetailsElement))
      throw new Error('Missing export advanced settings');
    advancedSettings.open = true;
    const xmlOption = exportDialog.querySelector<HTMLInputElement>('input[aria-label="Schema XML"]');
    if (!xmlOption) throw new Error('Missing Schema XML option');
    xmlOption.click();
    await flushPromises();
    button(exportDialog, '导出').click();
    await flushPromises();
    button(getDialog('确认导出'), '确认导出').click();
    await vi.waitFor(() => {
      expect(exportedBlob).not.toBeNull();
    });

    const blob = exportedBlob;
    if (!blob) throw new Error('Missing exported draft Blob');
    const exportedJson = await blob.text();
    const raw = JSON.parse(exportedJson) as { products: Record<string, unknown>[] };
    expect(raw.products[0]).toHaveProperty('schemaXml');
    expect(raw.products[0]).not.toHaveProperty('schemaJson');
    const exported = parseProductTransferJson(exportedJson);
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

    toolbarButton(wrapper.element as Element, '导入').click();
    await flushPromises();
    const importDialog = getDialog('导入商品');
    const input = importDialog.querySelector<HTMLInputElement>(
      'input[aria-label="选择商品 JSON 或 ZIP 文件"]'
    );
    if (!input) throw new Error('Missing product import input');
    const file = new File([fixtureJson], 'products.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      expect(importDialog.textContent).toContain('1 个商品');
    });
    expect(importDialog.textContent).toContain('products.json');
    expect(loadProductBatchPublishItems(localStorage)).toEqual([]);

    button(importDialog, '导入').click();
    await flushPromises();
    expect(loadProductBatchPublishItems(localStorage)).toEqual([]);
    button(getDialog('确认导入'), '确认导入').click();
    await vi.waitFor(() => {
      expect(loadProductBatchPublishItems(localStorage)).toHaveLength(1);
    });

    expect(loadProductBatchPublishItems(localStorage)).toMatchObject([
      { id: 'import:10000001:en_US', status: 'queued', title: 'Portable solar power station 1000W' }
    ]);
    expect(wrapper.text()).toContain('批量发品队列');
    expect(request.mock.calls.some(([operation]) => operation === 'publishProduct')).toBe(false);
    expect(request.mock.calls.some(([operation]) => operation === 'saveProductDraft')).toBe(false);
    wrapper.unmount();
  });

  it('exports a ZIP with deduplicated gallery assets and relative Schema references', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power station 1000W');
    });

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    toolbarButton(wrapper.element as Element, '导出').click();
    await flushPromises();
    const exportDialog = getDialog('导出商品');
    const details = exportDialog.querySelector('details');
    const zipOption = exportDialog.querySelector<HTMLInputElement>('input[aria-label="ZIP 资源包"]');
    if (!(details instanceof HTMLDetailsElement) || !zipOption) throw new Error('Missing ZIP setting');
    details.open = true;
    zipOption.click();
    button(exportDialog, '导出').click();
    await flushPromises();
    button(getDialog('确认导出'), '确认导出').click();
    await vi.waitFor(() => {
      expect(exportedBlob).not.toBeNull();
    });

    const blob = exportedBlob;
    if (!blob) throw new Error('Missing exported ZIP Blob');
    const archive = await readProductTransferArchive(await blobBytes(blob));
    expect(archive.assets).toHaveLength(1);
    expect(archive.document.products[0]?.schemaXml).toContain('assets/mock-product-asset-');
    expect(archive.document.products[0]?.schemaXml).not.toContain('https://sc04.alicdn.com');
    expect(request.mock.calls.filter(([operation]) => operation === 'downloadProductAsset')).toHaveLength(1);
    wrapper.unmount();
  });

  it('uploads ZIP assets before atomically adding products to the local queue', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const document = parseProductTransferArchiveJson(archiveFixtureJson);
    const archive = await createProductTransferArchive({
      document,
      assets: [
        { path: 'assets/cover.jpg', fileName: 'cover.jpg', contentType: 'image/jpeg', bytes: jpeg },
        { path: 'assets/detail.png', fileName: 'detail.png', contentType: 'image/png', bytes: png }
      ]
    });
    const wrapper = mountView(gateway);
    await flushPromises();

    toolbarButton(wrapper.element as Element, '导入').click();
    await flushPromises();
    const importDialog = getDialog('导入商品');
    const input = importDialog.querySelector<HTMLInputElement>(
      'input[aria-label="选择商品 JSON 或 ZIP 文件"]'
    );
    if (!input) throw new Error('Missing product import input');
    const file = new File([archive.slice().buffer], 'products.zip', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      expect(importDialog.textContent).toContain('2 张引用图片');
    });
    await vi.waitFor(() => {
      expect(button(importDialog, '导入').disabled).toBe(false);
    });
    expect(loadProductBatchPublishItems(localStorage)).toEqual([]);

    button(importDialog, '导入').click();
    await flushPromises();
    button(getDialog('确认导入'), '确认导入').click();
    await vi.waitFor(() => {
      expect(loadProductBatchPublishItems(localStorage)).toHaveLength(1);
    });

    const uploads = request.mock.calls.filter(([operation]) => operation === 'uploadPhoto');
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.[1]).toMatchObject({ groupId: '-1', fileName: 'cover.jpg' });
    const item = loadProductBatchPublishItems(localStorage)[0];
    expect(item?.xml).toContain('https://sc04.alicdn.com/kf/');
    expect(item?.xml).not.toContain('assets/cover.jpg');
    wrapper.unmount();
  });

  it('does not write the queue when a ZIP image upload fails', async () => {
    const gateway = new SecondUploadFailsGateway(0);
    const document = parseProductTransferArchiveJson(archiveFixtureJson);
    const archive = await createProductTransferArchive({
      document,
      assets: [
        { path: 'assets/cover.jpg', fileName: 'cover.jpg', contentType: 'image/jpeg', bytes: jpeg },
        { path: 'assets/detail.png', fileName: 'detail.png', contentType: 'image/png', bytes: png }
      ]
    });
    const wrapper = mountView(gateway);
    await flushPromises();
    toolbarButton(wrapper.element as Element, '导入').click();
    await flushPromises();
    const importDialog = getDialog('导入商品');
    const input = importDialog.querySelector<HTMLInputElement>(
      'input[aria-label="选择商品 JSON 或 ZIP 文件"]'
    );
    if (!input) throw new Error('Missing product import input');
    const file = new File([archive.slice().buffer], 'products.zip', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      expect(importDialog.textContent).toContain('2 张引用图片');
    });
    button(importDialog, '导入').click();
    await flushPromises();
    button(getDialog('确认导入'), '确认导入').click();
    await vi.waitFor(() => {
      expect(importDialog.textContent).toContain('second ZIP image upload failed');
    });

    expect(gateway.uploadCount).toBe(2);
    expect(loadProductBatchPublishItems(localStorage)).toEqual([]);
    wrapper.unmount();
  });
});

function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolveBytes, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error('Unable to read Blob'));
    };
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('Unable to read Blob'));
        return;
      }
      resolveBytes(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(blob);
  });
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
  return mount(Host, { attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
}

function toolbarButton(root: Element, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!match) throw new Error(`Missing toolbar button: ${label}`);
  return match;
}

function getDialog(title: string): HTMLElement {
  const match = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')]
    .toReversed()
    .find((dialog) => dialog.textContent.includes(title));
  if (!match) throw new Error(`Missing dialog: ${title}`);
  return match;
}

function button(root: Element, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
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
