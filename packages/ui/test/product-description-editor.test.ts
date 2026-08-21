// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core';

import ProductDescriptionEditor from '../src/components/ProductDescriptionEditor.vue';
import { provideServices } from '../src/lib/services';

function mountEditor(html: string, smartDetail = false) {
  const model = ref(html);
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        mode: 'mock'
      });
      return () =>
        h(ProductDescriptionEditor, {
          modelValue: model.value,
          smartDetail,
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
