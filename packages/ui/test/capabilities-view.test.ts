// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import CapabilitiesView from '../src/views/CapabilitiesView.vue';
import { provideServices } from '../src/lib/services';

function mountView(mode: 'mock' | 'extension' = 'mock') {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        mode
      });
      return () => h(CapabilitiesView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
}

function methodButton(wrapper: ReturnType<typeof mountView>, method: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === method);
  if (!result) throw new Error(`Missing method: ${method}`);
  return result;
}

async function filterMethod(wrapper: ReturnType<typeof mountView>, method: string): Promise<void> {
  await wrapper.get('input[placeholder="搜索 API 方法"]').setValue(method);
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain(method);
    expect(wrapper.text()).toContain('第 1 / 1 页');
  });
}

function callButton() {
  const result = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    candidate.textContent.includes('调用能力')
  );
  if (!result) throw new Error('Missing call button');
  return result;
}

function bodyText(): string {
  return document.body.textContent;
}

describe('CapabilitiesView platform safeguards', () => {
  it('keeps cancelled advanced filters unapplied and applies only the confirmed draft', async () => {
    const wrapper = mountView();
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.find('table').exists()).toBe(true);
    });
    const initial = wrapper.get('table').text();
    const open = async () => {
      const button = wrapper.findAll('button').find((item) => item.text().startsWith('筛选'));
      if (!button) throw new Error('Missing filter trigger');
      await button.trigger('click');
      await flushPromises();
    };
    const choose = async () => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="全部业务域"]');
      if (!select) throw new Error('Missing domain filter');
      await new DOMWrapper(select).setValue('photo');
    };
    const click = (label: string) => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
        (item) => item.textContent.trim() === label
      );
      if (!button) throw new Error(`Missing ${label}`);
      button.click();
    };
    await open();
    await choose();
    expect(wrapper.get('table').text()).toBe(initial);
    click('取消');
    await flushPromises();
    expect(wrapper.get('table').text()).toBe(initial);
    await open();
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="全部业务域"]')?.value).toBe('all');
    await choose();
    click('应用筛选');
    await flushPromises();
    expect(wrapper.get('table').text()).not.toBe(initial);
    expect(wrapper.get('table').text()).toContain('photobank');
    expect(wrapper.text()).toContain('筛选 · 1');
    wrapper.unmount();
  });
  it('explains delayed inventory readback without opening or dispatching a mutation', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await filterMethod(wrapper, 'alibaba.icbu.product.inventory.update');
    await methodButton(wrapper, 'alibaba.icbu.product.inventory.update').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="platform-readback-notice"]')?.textContent).toContain(
        '不要因此重复增减库存'
      );
      expect(callButton().disabled).toBe(true);
    });
    expect(document.body.querySelector('[data-testid="capability-result"]')).toBeNull();
    wrapper.unmount();
  });
  it('shows the four verification dimensions and filters historical account results', async () => {
    const wrapper = mountView();
    await flushPromises();

    const filter = wrapper.findAll('button').find((item) => item.text() === '筛选');
    if (!filter) throw new Error('Missing filter');
    await filter.trigger('click');
    await flushPromises();
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="账号验证快照"]');
    if (!select) throw new Error('Missing account filter');
    await new DOMWrapper(select).setValue('permission-denied');
    const apply = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (item) => item.textContent.trim() === '应用筛选'
    );
    if (!apply) throw new Error('Missing apply filter');
    apply.click();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('alibaba.icbu.rfq.search');
      expect(wrapper.text()).toContain('账号无权限');
    });

    await filterMethod(wrapper, 'alibaba.icbu.rfq.search');
    await methodButton(wrapper, 'alibaba.icbu.rfq.search').trigger('click');
    await vi.waitFor(() => {
      expect(bodyText()).toContain('isv.permission-api-package-limit');
    });

    expect(bodyText()).toContain('Replay 候选');
    expect(bodyText()).toContain('已有文档');
    expect(bodyText()).toContain('Mock 数据');
    expect(bodyText()).toContain('只表示当时验证凭据');
    wrapper.unmount();
  });

  it('shows risk protocol parameters read-only and explains sensitive data handling', async () => {
    const wrapper = mountView();
    await flushPromises();
    await filterMethod(wrapper, 'alibaba.icbu.risk.send');
    await methodButton(wrapper, 'alibaba.icbu.risk.send').trigger('click');
    await vi.waitFor(() => {
      expect(bodyText()).toContain('WUA、UMID、IMEI、IMSI、MAC');
    });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('pre[aria-label="只读文档参数示例"]')).not.toBeNull();
    expect(document.body.querySelector('textarea[aria-label="调用参数 JSON"]')).toBeNull();
    expect(callButton().disabled).toBe(true);
    wrapper.unmount();
  });

  it('keeps generic file transfer separate from the gallery and closed in the extension', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await filterMethod(wrapper, 'alibaba.icbu.file.urlposting.upload');
    await methodButton(wrapper, 'alibaba.icbu.file.urlposting.upload').trigger('click');
    await vi.waitFor(() => {
      expect(bodyText()).toContain('不返回图片银行 fileId');
    });

    expect(document.body.querySelector('textarea[aria-label="调用参数 JSON"]')).not.toBeNull();
    expect(bodyText()).toContain('通用调试器均仅允许只读调用');
    expect(callButton().disabled).toBe(true);
    wrapper.unmount();
  });
});

function settings() {
  return {
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac' as const
  };
}
