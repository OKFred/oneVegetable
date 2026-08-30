// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it } from 'vitest';

import {
  BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA,
  OPERATION_IDS,
  StaticOperationAvailabilityClient,
  type ProductDescriptionTemplateClient,
  type ProductDescriptionTemplateListInput,
  type ProductDescriptionTemplatePage
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { MemoryProductDescriptionTemplateClient } from '@one-vegetable/core/templates';

import ProductDescriptionEditor from '../src/components/ProductDescriptionEditor.vue';
import { provideServices } from '../src/lib/services';

function mountEditor(
  html: string,
  smartDetail = false,
  productDescriptionTemplates: ProductDescriptionTemplateClient = new MemoryProductDescriptionTemplateClient(
    BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates,
    { writable: false }
  )
) {
  const model = ref(html);
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        productDescriptionTemplates,
        operationAvailability: new StaticOperationAvailabilityClient(new Set(OPERATION_IDS)),
        mode: 'mock'
      });
      return () =>
        h(ProductDescriptionEditor, {
          modelValue: model.value,
          smartDetail,
          language: 'en_US',
          'onUpdate:modelValue': (value: string) => {
            model.value = value;
          }
        });
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    model,
    wrapper: mount(Host, {
      attachTo: document.body,
      global: { plugins: [[VueQueryPlugin, { queryClient }]] }
    })
  };
}

describe('ProductDescriptionEditor', () => {
  it('keeps smart details unchanged until the review and confirmation steps complete', async () => {
    const original = '<h2>Smart detail</h2><p>Original body</p>';
    const { model, wrapper } = mountEditor(original, true);
    expect(wrapper.text()).toContain('智能详情');
    expect(model.value).toBe(original);

    const review = wrapper.findAll('button').find((button) => button.text().includes('查看转换变化'));
    if (!review) throw new Error('Missing conversion review button');
    await review.trigger('click');
    expect(wrapper.text()).toContain('智能详情将降级为 API 可维护的普通详情');
    expect(model.value).toBe(original);

    const confirm = wrapper.findAll('button').find((button) => button.text().includes('确认转换'));
    if (!confirm) throw new Error('Missing conversion confirmation button');
    await confirm.trigger('click');
    await nextTick();
    expect(wrapper.find('.ProseMirror').exists()).toBe(true);
    expect(model.value).toContain('<h2>Smart detail</h2>');
    wrapper.unmount();
  });

  it('shows unsupported HTML changes before generating safe ordinary detail', async () => {
    const { model, wrapper } = mountEditor(
      '<div class="legacy"><h2 style="color:red">Legacy title</h2><img src="https://sc04.alicdn.com/kf/legacy.jpg" alt="Legacy image"><script>alert(1)</script></div>'
    );
    expect(wrapper.text()).toContain('旧详情含不支持的 HTML');
    expect(model.value).toContain('<script>');
    await flushPromises();
    await nextTick();
    const preview = wrapper.get('[aria-label="平台原始详情安全预览"]');
    expect(preview.text()).toContain('Legacy title');
    expect(preview.find('img[alt="Legacy image"]').exists()).toBe(true);
    expect(preview.text()).not.toContain('alert(1)');

    await wrapper.get('button[role="tab"][aria-selected="false"]').trigger('click');
    expect(wrapper.get('[aria-label="平台原始详情 HTML 源码"]').text()).toContain(
      '<script>alert(1)</script>'
    );

    const review = wrapper.findAll('button').find((button) => button.text().includes('查看转换变化'));
    if (!review) throw new Error('Missing conversion review button');
    await review.trigger('click');
    expect(wrapper.text()).toContain('删除不允许的 <script> 元素及内容');
    wrapper.unmount();
  });

  it('inserts a selected PhotoBank image with its internal file ID', async () => {
    const { model, wrapper } = mountEditor('<p>Product overview</p>');
    await flushPromises();
    const picker = wrapper.findAll('button').find((button) => button.text().includes('插入图库图片'));
    if (!picker) throw new Error('Missing PhotoBank picker');
    await picker.trigger('click');
    await flushPromises();
    const photo = document.body
      .querySelector<HTMLButtonElement>('button img[alt="solar-station-front.jpg"]')
      ?.closest('button');
    if (!photo) throw new Error('Missing mock PhotoBank image');
    photo.click();
    await nextTick();
    expect(model.value).toContain('data-photobank-file-id="ph_001"');
    expect(model.value).toContain('https://sc04.alicdn.com/');
    wrapper.unmount();
  });

  it('appends templates and previews replacements before changing the description', async () => {
    const { model, wrapper } = mountEditor('<p>Original details</p>');
    await flushPromises();
    await clickButton('详情模板');
    await flushPromises();
    expect(document.body.textContent).toContain('Company profile');

    await clickButton('追加末尾', templateCard('Company profile'));
    await nextTick();
    expect(model.value).toContain('Original details');
    expect(model.value).toContain('About Us');

    await clickButton('详情模板');
    await flushPromises();
    await clickButton('覆盖全文', templateCard('Shipping and delivery'));
    await nextTick();
    expect(document.body.textContent).toContain('当前详情');
    expect(document.body.textContent).toContain('覆盖后：Shipping and delivery');
    expect(model.value).toContain('Original details');

    await clickButton('确认覆盖全文');
    await nextTick();
    expect(model.value).not.toContain('Original details');
    expect(model.value).toContain('Shipping and Delivery');
    wrapper.unmount();
  });

  it('keeps loaded template actions available while reopening refreshes the list', async () => {
    const client = new DelayedRefreshTemplateClient();
    const { wrapper } = mountEditor('<p>Original details</p>', false, client);
    await flushPromises();

    await clickButton('详情模板');
    await flushPromises();
    await clickButton('追加末尾', templateCard('Company profile'));

    await clickButton('详情模板');
    await nextTick();
    expect(document.body.textContent).toContain('正在刷新模板');
    await clickButton('覆盖全文', templateCard('Shipping and delivery'));
    expect(document.body.textContent).toContain('确认覆盖商品详情');

    client.releaseRefresh();
    await flushPromises();
    wrapper.unmount();
  });
});

class DelayedRefreshTemplateClient extends MemoryProductDescriptionTemplateClient {
  #listCalls = 0;
  #releaseRefresh: (() => void) | undefined;

  constructor() {
    super(BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates, { writable: false });
  }

  override async list(
    input: ProductDescriptionTemplateListInput = {}
  ): Promise<ProductDescriptionTemplatePage> {
    this.#listCalls += 1;
    if (this.#listCalls > 1) {
      await new Promise<void>((resolve) => {
        this.#releaseRefresh = resolve;
      });
    }
    return super.list(input);
  }

  releaseRefresh(): void {
    this.#releaseRefresh?.();
  }
}

function templateCard(name: string): HTMLElement {
  const card = [...document.body.querySelectorAll<HTMLElement>('article')].find((element) =>
    element.textContent.includes(name)
  );
  if (!card) throw new Error(`Missing template card: ${name}`);
  return card;
}

async function clickButton(label: string, container: ParentNode = document.body): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    candidate.textContent.includes(label)
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  button.click();
  await nextTick();
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
