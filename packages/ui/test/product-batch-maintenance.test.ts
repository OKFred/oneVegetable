// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { ProductBatchMaintenanceRunner } from '@one-vegetable/core/product-batch-runner';
import { previewProductBatchMaintenance } from '@one-vegetable/core/product-batch-maintenance';
import fixture from '../../../mock/data/product-batch-maintenance.json';
import ProductBatchMaintenance from '../src/components/ProductBatchMaintenance.vue';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';

const xml = readFileSync(resolve('mock/data/product-schema/batch-maintenance.xml'), 'utf8');
describe('batch maintenance editor', () => {
  beforeEach(() => {
    uiI18n.global.locale.value = 'zh-CN';
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: {
        request: (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({})
      }
    });
    vi.spyOn(ProductBatchMaintenanceRunner.prototype, 'preview').mockImplementation(async function (
      this: ProductBatchMaintenanceRunner,
      rules
    ) {
      for (const item of this.items) {
        item.preview = await previewProductBatchMaintenance(xml, rules);
        item.state = item.preview.status;
      }
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
  function editor() {
    const Host = defineComponent({
      setup() {
        provideServices({
          gateway: new MockGatewayClient(0),
          mode: 'mock',
          settings: { load: () => Promise.reject(new Error('unused')), save: () => Promise.resolve() },
          productMutationJobs: {
            list: () => Promise.resolve({ items: [], page: 1, pageSize: 100, total: 0 }),
            get: () => Promise.reject(new Error('unused')),
            refresh: () => Promise.reject(new Error('unused')),
            recover: () => Promise.reject(new Error('No writes'))
          },
          operationAvailability: {
            get: (operations) =>
              Promise.resolve({
                items: operations.map((operation) => ({ operation, allowed: true, reasonCode: null }))
              })
          }
        });
        return () =>
          h(ProductBatchMaintenance, {
            products: [
              { ...fixture.product, status: 'online' },
              { ...fixture.product, id: '302', status: 'online' }
            ],
            language: 'en_US'
          });
      }
    });
    return mount(Host, {
      attachTo: document.body,
      global: {
        plugins: [
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }
          ]
        ]
      }
    });
  }
  it('previews without submitting, excludes individual records and confirms actual counts', async () => {
    const execute = vi.spyOn(ProductBatchMaintenanceRunner.prototype, 'execute').mockResolvedValue();
    const wrapper = editor();
    await wrapper.get('select').setValue('append');
    await wrapper.get('input[aria-label="关键词 1"]').setValue('Linen');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '预览差异')
      ?.trigger('click');
    await flushPromises();
    expect(execute).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Linen');
    });
    const rows = wrapper.findAll('input[type="checkbox"][value]');
    expect(rows).toHaveLength(2);
    await rows[1]?.setValue(false);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认执行')
      ?.trigger('click');
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('实际提交 1 件，跳过 1 件');
    expect(execute).not.toHaveBeenCalled();
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (b) => b.textContent.trim() === '确认'
    );
    expect(confirm).toBeDefined();
    confirm?.click();
    await flushPromises();
    expect(execute).toHaveBeenCalledOnce();
    const executed: unknown = execute.mock.contexts[0];
    expect(executed).toBeInstanceOf(ProductBatchMaintenanceRunner);
    if (executed instanceof ProductBatchMaintenanceRunner)
      expect(executed.items.filter((i) => i.selected)).toHaveLength(1);
    wrapper.unmount();
  });
  it('invalidates old previews when editing rules and stops on unmount', async () => {
    const stop = vi.spyOn(ProductBatchMaintenanceRunner.prototype, 'stop');
    const wrapper = editor();
    await wrapper.get('select').setValue('append');
    await wrapper.get('input[aria-label="关键词 1"]').setValue('Linen');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '预览差异')
      ?.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.findAll('input[type="checkbox"][value]')).toHaveLength(2);
    });
    await wrapper.get('input[aria-label="关键词 1"]').setValue('Silk');
    expect(wrapper.findAll('input[type="checkbox"][value]')).toHaveLength(0);
    expect(stop).toHaveBeenCalled();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '预览差异')
      ?.trigger('click');
    await flushPromises();
    const count = stop.mock.calls.length;
    wrapper.unmount();
    expect(stop.mock.calls.length).toBe(count + 1);
  });
  it('fails closed without Web Locks, and switches UI language without reading Schema', async () => {
    Reflect.deleteProperty(globalThis.navigator, 'locks');
    const wrapper = editor();
    expect(wrapper.text()).toContain('多窗口执行锁');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(wrapper.text()).toContain('Batch maintenance');
    expect(vi.mocked(ProductBatchMaintenanceRunner.prototype).preview.mock.calls).toHaveLength(0);
    wrapper.unmount();
  });
});
