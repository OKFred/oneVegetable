// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BffControlClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type { ControlGatewayCredentialSummary, ControlSession } from '@one-vegetable/core';
import GatewayCredentialPanel from '../src/components/GatewayCredentialPanel.vue';
import UnsavedEditingDialog from '../src/components/UnsavedEditingDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideUnsavedEditing, UnsavedEditingService } from '../src/lib/unsaved-editing';
import { uiI18n } from '../src/i18n';
import fixture from '../../../mock/data/node-gateway-credentials.json';

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
});
async function harness(
  role: 'admin' | 'user' = 'admin',
  overrides: Partial<ControlGatewayCredentialSummary> = {},
  realDialogs = false
) {
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
    remark: null,
    ...overrides
  };
  const status = vi.spyOn(client, 'gatewayCredentialStatus').mockResolvedValue(summary);
  const save = vi.spyOn(client, 'saveGatewayCredential').mockResolvedValue({ ...summary, revision: 2 });
  const importCredential = vi
    .spyOn(client, 'importGatewayCredential')
    .mockResolvedValue({ ...summary, revision: 2 });
  const clear = vi.spyOn(client, 'clearGatewayCredential').mockResolvedValue();
  const test = vi.spyOn(client, 'testGatewayCredential').mockResolvedValue({
    status: 'passed',
    requestId: crypto.randomUUID(),
    checkedAtUtc: 1,
    durationMilliseconds: 1,
    configurationId: null,
    errorCode: null
  });
  const editing = new UnsavedEditingService();
  const Host = defineComponent({
    setup() {
      provideUnsavedEditing(editing);
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
      // Match the shell: the global leave dialog is mounted before the settings panel.
      return () => [h(UnsavedEditingDialog, { service: editing }), h(GatewayCredentialPanel)];
    }
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      stubs: realDialogs
        ? {}
        : {
            ModalDialog: {
              props: ['open'],
              template: '<div v-if="open"><slot /><slot name="footer" /></div>'
            }
          }
    }
  });
  await flushPromises();
  const button = (text: string) => {
    const result = wrapper.findAll('button').find((b) => b.text() === text);
    if (!result) throw new Error(`Missing ${text}`);
    return result;
  };
  return { wrapper, status, save, importCredential, clear, test, button, editing };
}
describe('Node credential configuration UI', () => {
  it.each([undefined, 'top', 'iop'] as const)(
    'shows %s protocol without changing the current configuration',
    async (protocol) => {
      const h = await harness('admin', protocol === undefined ? {} : { protocol });
      expect(h.wrapper.get('[data-testid="gateway-protocol-summary"]').text()).toContain(
        protocol === 'iop' ? 'IOP' : 'TOP'
      );
      await h.button('手动填写').trigger('click');
      expect((h.wrapper.get('select[aria-label="网关协议"]').element as HTMLSelectElement).value).toBe(
        protocol ?? 'top'
      );
      expect(h.save).not.toHaveBeenCalled();
      expect(h.test).not.toHaveBeenCalled();
      h.wrapper.unmount();
    }
  );
  it('includes an explicitly selected IOP marker in confirmed manual saves', async () => {
    const h = await harness();
    await h.button('手动填写').trigger('click');
    await h.wrapper.get('select[aria-label="网关协议"]').setValue('iop');
    expect(h.wrapper.get('[data-testid="iop-protocol-notice"]').text()).toContain('通过账号验收的方法');
    const inputs = h.wrapper.findAll('input[type="password"]');
    await inputs[0]?.setValue(fixture.manual.appKey);
    await inputs[1]?.setValue(fixture.manual.appSecret);
    await inputs[2]?.setValue(fixture.manual.accessToken);
    await h.wrapper.get('form').trigger('submit');
    expect(h.save).not.toHaveBeenCalled();
    h.wrapper
      .findAll('button')
      .find((button) => button.text() === '确认')
      ?.element.click();
    await flushPromises();
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'iop' }), 1, null);
    expect(h.test).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
  it('shows protocol-specific IOP renewal guidance in both languages, without TOP commands', async () => {
    const h = await harness('admin', { protocol: 'iop' });
    expect(h.wrapper.text()).toContain('独立 IOP 授权工具');
    expect(h.wrapper.text()).not.toContain('pnpm openapi:auth');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(h.wrapper.text()).toContain('independent IOP tool');
    expect(h.wrapper.text()).not.toContain('pnpm openapi:auth');
    expect(h.test).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
  it('previews and imports the IOP marker only after confirmation', async () => {
    const h = await harness();
    const bundle = { ...fixture.oauthBundle, protocol: 'iop' };
    const content = JSON.stringify(bundle);
    const file = new File([content], 'credentials.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
    const input = h.wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await flushPromises();
    expect(h.wrapper.text()).toContain('IOP（显式选择）');
    expect(h.importCredential).not.toHaveBeenCalled();
    h.wrapper
      .findAll('button')
      .find((button) => button.text() === '确认')
      ?.element.click();
    await flushPromises();
    expect(h.importCredential).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'iop' }), 1);
    expect(h.test).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
  it('renders an icon on all six credential actions', async () => {
    const h = await harness();
    for (const label of ['导入授权 JSON', '手动填写', '测试连接', '刷新 Token', '刷新状态', '清除配置'])
      expect(h.button(label).find('svg').exists()).toBe(true);
    h.wrapper.unmount();
  });
  it.each([null, 864_000_000])(
    'does not equate a refresh failure with access revocation (%s expiry)',
    async (lifetime) => {
      const h = await harness('admin', {
        accessTokenExpiresTimeUtc: lifetime === null ? null : Date.now() + lifetime,
        lastRefreshErrorCode: 'ALIBABA_TOKEN_REFRESH_FAILED'
      });
      const notice = h.wrapper.get('[data-testid="credential-expiry"]');
      expect(notice.text()).toContain(lifetime === null ? '有效期未知' : '有效期内');
      expect(notice.text()).not.toContain('授权已失效');
      expect(h.wrapper.text()).toContain('ALIBABA_TOKEN_REFRESH_FAILED');
      expect(h.test).not.toHaveBeenCalled();
      h.wrapper.unmount();
    }
  );
  it('exposes manual entry beside import and closes an unchanged real dialog immediately', async () => {
    const h = await harness('admin', {}, true);
    const manual = h.button('手动填写');
    expect(manual.element.closest('details')).toBeNull();
    expect(manual.element.parentElement).toBe(h.button('导入授权 JSON').element.parentElement);
    await manual.trigger('click');
    await flushPromises();
    const body = new DOMWrapper(document.body);
    expect(body.findAll('[role="dialog"]')).toHaveLength(1);
    await body.get('button[aria-label="关闭手动填写"]').trigger('click');
    await flushPromises();
    expect(body.find('[role="dialog"]').exists()).toBe(false);
    expect(h.editing.confirmationOpen.value).toBe(false);
    expect(h.save).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });

  it('keeps dirty dismissal inside the real modal, allows returning and clears only after discarding', async () => {
    const h = await harness('admin', {}, true);
    const body = new DOMWrapper(document.body);
    await h.button('手动填写').trigger('click');
    await flushPromises();
    await body.get('input[type="password"]').setValue(fixture.manual.appKey);
    await body.get('button[aria-label="关闭手动填写"]').trigger('click');
    await flushPromises();
    expect(body.findAll('[role="dialog"]')).toHaveLength(2);
    expect(h.editing.confirmationOpen.value).toBe(false);
    const keep = body.findAll('button').find((button) => button.text() === '继续编辑');
    expect(keep).toBeDefined();
    await keep?.trigger('click');
    await flushPromises();
    expect(body.findAll('[role="dialog"]')).toHaveLength(1);
    expect((body.get('input[type="password"]').element as HTMLInputElement).value).toBe(
      fixture.manual.appKey
    );
    expect(h.editing.dirty.value).toBe(true);
    await body.get('form button[type="button"]').trigger('click');
    await flushPromises();
    const discard = body.findAll('button').find((button) => button.text() === '放弃修改并离开');
    await discard?.trigger('click');
    await flushPromises();
    expect(body.find('[role="dialog"]').exists()).toBe(false);
    expect(h.editing.dirty.value).toBe(false);
    expect(h.save).not.toHaveBeenCalled();
    await h.button('手动填写').trigger('click');
    await flushPromises();
    expect((body.get('input[type="password"]').element as HTMLInputElement).value).toBe('');
    h.wrapper.unmount();
  });
  it('shows expired startup-file authorization even when configured is false', async () => {
    const h = await harness('admin', {
      source: 'credential-bundle',
      configured: false,
      accessTokenExpiresTimeUtc: 1
    });
    expect(h.wrapper.get('[data-testid="credential-expiry"]').text()).toContain('授权已到期');
    expect(h.test).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
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
