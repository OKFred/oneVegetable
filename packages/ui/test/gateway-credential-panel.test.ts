// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BffControlClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type { ControlGatewayCredentialSummary, ControlSession } from '@one-vegetable/core';
import GatewayCredentialPanel from '../src/components/GatewayCredentialPanel.vue';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import fixture from '../../../mock/data/node-gateway-credentials.json';

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});
async function harness(role: 'admin' | 'user' = 'admin') {
  const client = new BffControlClient({ baseUrl: 'http://localhost:8787' });
  const user: ControlSession['user'] = {
    id: 'admin',
    username: 'admin',
    role,
    status: 'active',
    lockedUntilUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    creatorId: 'system',
    updaterId: 'system',
    revision: 1,
    remark: null
  };
  vi.spyOn(client, 'session').mockResolvedValue({
    user,
    principal: { actorId: 'admin', username: 'admin', role, source: 'bff' },
    absoluteExpiresTimeUtc: Date.now() + 60000,
    idleExpiresTimeUtc: Date.now() + 60000
  });
  const summary: ControlGatewayCredentialSummary = {
    configured: true,
    revision: 1,
    source: 'sqlite-vault',
    appName: fixture.manual.appName,
    appKeySuffix: '-key',
    canRefresh: false,
    accessTokenExpiresTimeUtc: null,
    refreshTokenExpiresTimeUtc: null,
    lastRefreshTimeUtc: null,
    lastRefreshErrorCode: null,
    updateTimeUtc: 1,
    updaterId: 'admin',
    remark: null
  };
  const status = vi.spyOn(client, 'gatewayCredentialStatus').mockResolvedValue(summary);
  const save = vi.spyOn(client, 'saveGatewayCredential').mockResolvedValue({ ...summary, revision: 2 });
  const clear = vi.spyOn(client, 'clearGatewayCredential').mockResolvedValue();
  const test = vi.spyOn(client, 'testGatewayCredential').mockResolvedValue({
    status: 'passed',
    requestId: crypto.randomUUID(),
    checkedAtUtc: 1,
    durationMilliseconds: 1,
    configurationId: null,
    errorCode: null
  });
  const Host = defineComponent({
    setup() {
      provideServices({
        mode: 'bff',
        control: client,
        gateway: new MockGatewayClient(0),
        settings: {
          load: () =>
            Promise.resolve({
              appKey: '',
              appSecret: '',
              accessToken: '',
              endpoint: 'https://eco.taobao.com/router/rest',
              signMethod: 'hmac'
            }),
          save: () => Promise.resolve(undefined)
        },
        runtime: {
          metaStatus: 'ready',
          backendMeta: {
            runtime: 'node',
            database: 'sqlite',
            environment: 'local-node',
            gatewayMode: 'real',
            apiPrefix: '/api/v1',
            version: '2.6.0'
          }
        }
      });
      return () => h(GatewayCredentialPanel);
    }
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      stubs: {
        ModalDialog: { props: ['open'], template: '<div v-if="open"><slot /><slot name="footer" /></div>' }
      }
    }
  });
  await flushPromises();
  const button = (text: string) => {
    const result = wrapper.findAll('button').find((b) => b.text() === text);
    if (!result) throw new Error(`Missing ${text}`);
    return result;
  };
  return { wrapper, status, save, clear, test, button };
}
describe('Node credential configuration UI', () => {
  it('requires confirmation before manual save and never exposes saved secrets or auto-tests', async () => {
    const h = await harness();
    expect(h.wrapper.text()).not.toContain(fixture.manual.appSecret);
    expect(h.test).not.toHaveBeenCalled();
    await h.button('手动填写').trigger('click');
    const inputs = h.wrapper.findAll('input[type="password"]');
    await inputs[0]?.setValue(fixture.manual.appKey);
    await inputs[1]?.setValue(fixture.manual.appSecret);
    await inputs[2]?.setValue(fixture.manual.accessToken);
    expect(h.wrapper.find('[data-feedback-redact]').exists()).toBe(true);
    await h.wrapper.get('form').trigger('submit');
    expect(h.save).not.toHaveBeenCalled();
    const confirm = h.wrapper.findAll('button').find((b) => b.text() === '确认')?.element;
    expect(confirm).not.toBeNull();
    confirm?.click();
    await flushPromises();
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.test).not.toHaveBeenCalled();
    expect(h.wrapper.find('input[type="password"]').exists()).toBe(false);
    h.wrapper.unmount();
  });
  it('requires clear confirmation and offers an explicit real connection test', async () => {
    const h = await harness();
    await h.button('清除配置').trigger('click');
    expect(h.clear).not.toHaveBeenCalled();
    const cancel = h.wrapper.findAll('button').find((b) => b.text() === '取消')?.element;
    expect(cancel).not.toBeNull();
    cancel?.click();
    await flushPromises();
    expect(h.clear).not.toHaveBeenCalled();
    await h.button('测试连接').trigger('click');
    await flushPromises();
    expect(h.test).toHaveBeenCalledOnce();
    expect(h.wrapper.text()).toContain('连接测试通过');
    h.wrapper.unmount();
  });
  it('does not expose administrator controls to ordinary users', async () => {
    const h = await harness('user');
    expect(h.status).not.toHaveBeenCalled();
    expect(h.wrapper.text()).toContain('只有管理员');
    expect(h.wrapper.find('input').exists()).toBe(false);
    h.wrapper.unmount();
  });
});
