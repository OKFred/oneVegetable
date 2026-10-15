// @vitest-environment jsdom
import { defineComponent, h, type Component } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';
import {
  ALIBABA_GATEWAY,
  BffControlClient,
  type AlibabaAuthorizationsSummary,
  type ControlGatewayCredentialSummary,
  type ControlSession,
  type GatewaySettings
} from '@one-vegetable/core';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import dashboardFixture from '../../../mock/data/dashboard-authorization.json';
import AlibabaAuthorizationsPanel from '../src/components/AlibabaAuthorizationsPanel.vue';
import GatewayAuthorizationsPanel from '../src/components/GatewayAuthorizationsPanel.vue';
import GatewayCredentialPanel from '../src/components/GatewayCredentialPanel.vue';
import DashboardAuthorizationCard from '../src/components/DashboardAuthorizationCard.vue';
import DashboardAuthorizationAction from '../src/components/DashboardAuthorizationAction.vue';
import UnsavedEditingDialog from '../src/components/UnsavedEditingDialog.vue';
import SettingsView from '../src/views/SettingsView.vue';
import { uiI18n } from '../src/i18n';
import { provideServices } from '../src/lib/services';
import { provideUnsavedEditing, UnsavedEditingService } from '../src/lib/unsaved-editing';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  uiI18n.global.locale.value = 'zh-CN';
  document.body.innerHTML = '';
});

function profile(protocol: 'top' | 'iop'): ControlGatewayCredentialSummary {
  return {
    ...(dashboardFixture.credential as ControlGatewayCredentialSummary),
    protocol,
    configurationId: `${protocol}-opaque-configuration`,
    revision: protocol === 'top' ? 11 : 37,
    canRefresh: true,
    accessTokenExpiresTimeUtc: protocol === 'top' ? null : Date.now() + 30 * 86_400_000,
    lastRefreshErrorCode: null,
    managementAvailable: true
  };
}
function dualSummary(): AlibabaAuthorizationsSummary {
  return {
    top: profile('top'),
    iop: profile('iop'),
    defaultProtocol: 'top',
    binding: { confirmed: false, topConfigurationId: null, iopConfigurationId: null, confirmedAtUtc: null }
  };
}
function settingsFor(protocol: 'top' | 'iop'): GatewaySettings {
  return {
    protocol,
    appKey: `${protocol}-key`,
    appSecret: '',
    accessToken: '',
    endpoint: protocol === 'top' ? ALIBABA_GATEWAY : IOP_BUSINESS_ENDPOINT,
    signMethod: protocol === 'top' ? 'hmac' : 'hmac-sha256',
    accessTokenExpiresTimeUtc: protocol === 'top' ? null : Date.now() + 30 * 86_400_000
  };
}
async function harness(
  component: unknown,
  options: {
    props?: Record<string, unknown>;
    extension?: boolean;
    legacy?: boolean;
    role?: 'admin' | 'user';
    summary?: AlibabaAuthorizationsSummary;
    locked?: boolean;
  } = {}
) {
  let current = options.summary ?? dualSummary();
  const client = new BffControlClient({ baseUrl: 'http://localhost:8787' });
  const readSession = vi.spyOn(client, 'session').mockResolvedValue({
    ...(dashboardFixture.session as ControlSession),
    principal: { ...(dashboardFixture.session as ControlSession).principal, role: options.role ?? 'admin' }
  });
  const read = vi.spyOn(client, 'gatewayAuthorizations').mockImplementation(() => Promise.resolve(current));
  const status = vi.spyOn(client, 'gatewayCredentialStatus').mockImplementation((protocol = 'top') =>
    Promise.resolve(
      current[protocol] ?? {
        ...profile(protocol),
        configured: false,
        revision: null,
        configurationId: null
      }
    )
  );
  const confirm = vi.spyOn(client, 'confirmGatewayAuthorizations').mockImplementation((topId, iopId) => {
    current = {
      ...current,
      binding: {
        confirmed: true,
        topConfigurationId: topId,
        iopConfigurationId: iopId,
        confirmedAtUtc: Date.now()
      }
    };
    return Promise.resolve(current);
  });
  const save = vi
    .spyOn(client, 'saveGatewayCredential')
    .mockImplementation((credentials, _revision, _remark, protocol) => {
      const target = protocol ?? credentials.protocol ?? 'top';
      current = {
        ...current,
        [target]: { ...profile(target), configurationId: `${target}-replacement`, revision: 50 },
        binding: dualSummary().binding
      };
      return Promise.resolve(current[target] ?? profile(target));
    });
  const importCredential = vi.spyOn(client, 'importGatewayCredential').mockResolvedValue(profile('iop'));
  const clear = vi
    .spyOn(client, 'clearGatewayCredential')
    .mockImplementation((_revision, protocol = 'top') => {
      current = { ...current, [protocol]: null, binding: dualSummary().binding };
      return Promise.resolve();
    });
  const refresh = vi
    .spyOn(client, 'refreshGatewayCredential')
    .mockImplementation((protocol = 'top') => Promise.resolve(current[protocol] ?? profile(protocol)));
  const test = vi.spyOn(client, 'testGatewayCredential').mockResolvedValue({
    status: 'passed',
    requestId: 'test-request',
    checkedAtUtc: 1,
    durationMilliseconds: 1,
    configurationId: null,
    errorCode: null
  });
  if (options.legacy) {
    Object.defineProperty(client, 'gatewayAuthorizations', { value: undefined });
    Object.defineProperty(client, 'confirmGatewayAuthorizations', { value: undefined });
  }
  const load = vi.fn(() => Promise.resolve(settingsFor('top')));
  const loadAuthorization = vi.fn((protocol: 'top' | 'iop') => Promise.resolve(settingsFor(protocol)));
  const settingsSummary = vi.fn(() => Promise.resolve(current));
  const saveSettings = vi.fn((settings: GatewaySettings) => {
    const protocol = settings.protocol ?? 'top';
    current = {
      ...current,
      [protocol]: { ...profile(protocol), configurationId: `${protocol}-replacement` },
      binding: dualSummary().binding
    };
    return Promise.resolve();
  });
  const clearAuthorization = vi.fn((protocol: 'top' | 'iop') => {
    current = { ...current, [protocol]: null, binding: dualSummary().binding };
    return Promise.resolve();
  });
  const refreshAuthorization = vi.fn((_protocol: 'top' | 'iop') => Promise.resolve(current));
  const confirmAuthorizations = vi.fn((topId: string, iopId: string) => {
    current = {
      ...current,
      binding: {
        confirmed: true,
        topConfigurationId: topId,
        iopConfigurationId: iopId,
        confirmedAtUtc: Date.now()
      }
    };
    return Promise.resolve(current);
  });
  const editing = new UnsavedEditingService();
  const Host = defineComponent({
    setup() {
      provideUnsavedEditing(editing);
      provideServices({
        gateway: new MockGatewayClient(0),
        control: client,
        mode: options.extension ? 'extension' : 'bff',
        settings: {
          load,
          save: saveSettings,
          ...(!options.legacy
            ? {
                authorizations: settingsSummary,
                loadAuthorization,
                clearAuthorization,
                refreshAuthorization,
                confirmAuthorizations
              }
            : {})
        },
        ...(options.extension
          ? {
              vault: {
                status: vi.fn().mockResolvedValue({
                  state: options.locked ? 'locked' : 'unlocked',
                  hasAccessToken: true,
                  hasAppSecret: true,
                  policy: { idleTimeoutMinutes: 0 },
                  lastActivityAt: null,
                  idleRemainingSeconds: null
                }),
                create: vi.fn(),
                migrate: vi.fn(),
                unlock: vi.fn(),
                lock: vi.fn(),
                rotate: vi.fn(),
                updatePolicy: vi.fn()
              }
            }
          : {}),
        runtime: {
          metaStatus: 'ready',
          backendMeta: {
            runtime: 'node',
            database: 'sqlite',
            environment: 'local-node',
            gatewayMode: 'real',
            apiPrefix: '/api/v1',
            version: '2.15.1'
          }
        }
      });
      // vue-tsc checks SFC imports; ESLint's TS parser does not resolve their component types.
      return () => [h(UnsavedEditingDialog, { service: editing }), h(component as Component, options.props)];
    }
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      stubs: {
        ModalDialog: {
          props: ['open', 'title', 'description'],
          template:
            '<div v-if="open" role="dialog"><h2>{{ title }}</h2><p>{{ description }}</p><slot /><slot name="footer" /></div>'
        }
      }
    }
  });
  wrappers.push(wrapper);
  await flushPromises();
  await vi.dynamicImportSettled();
  await flushPromises();
  return {
    wrapper,
    client,
    readSession,
    read,
    status,
    confirm,
    save,
    importCredential,
    clear,
    refresh,
    test,
    editing,
    load,
    loadAuthorization,
    settingsSummary,
    saveSettings,
    clearAuthorization,
    refreshAuthorization,
    confirmAuthorizations,
    current: () => current,
    replace: (summary: AlibabaAuthorizationsSummary) => {
      current = summary;
    }
  };
}
function button(wrapper: VueWrapper, label: string) {
  const result = wrapper.findAll('button').find((item) => item.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function importFile(wrapper: VueWrapper, bundle: unknown): Promise<void> {
  const content = JSON.stringify(bundle);
  const file = new File([content], 'authorization.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
  await input.trigger('change');
  await flushPromises();
}
async function manualSave(wrapper: VueWrapper): Promise<void> {
  await button(wrapper, '手动填写').trigger('click');
  const inputs = wrapper.findAll('input[type="password"]');
  await inputs[0]?.setValue(fixture.manual.appKey);
  await inputs[1]?.setValue(fixture.manual.appSecret);
  await inputs[2]?.setValue(fixture.manual.accessToken);
  await wrapper.get('form').trigger('submit');
  await button(wrapper, '确认').trigger('click');
  await flushPromises();
}

describe('independent authorization metadata and automatic capability routing', () => {
  it.each([false, true])(
    'notifies profile selection without saving or changing defaults (extension=%s)',
    async (extension) => {
      const view = await harness(extension ? SettingsView : GatewayAuthorizationsPanel, { extension });
      await view.wrapper.get('[data-testid="select-authorization-top"]').trigger('click');
      expect(toast.info).toHaveBeenLastCalledWith('当前正在配置 TOP，请在下方导入或填写。');
      await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
      await flushPromises();
      expect(toast.info).toHaveBeenLastCalledWith('已切换到 IOP 配置，请在下方导入或填写；默认协议未改变。');
      expect(view.current().defaultProtocol).toBe('top');
      expect(view.save).not.toHaveBeenCalled();
      expect(view.saveSettings).not.toHaveBeenCalled();
      expect(view.test).not.toHaveBeenCalled();
      expect(view.refresh).not.toHaveBeenCalled();
      const reads = extension ? view.loadAuthorization.mock.calls.length : view.status.mock.calls.length;
      await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
      expect(toast.info).toHaveBeenLastCalledWith('当前正在配置 IOP，请在下方导入或填写。');
      expect(extension ? view.loadAuthorization.mock.calls.length : view.status.mock.calls.length).toBe(
        reads
      );
    }
  );

  it('does not announce a switch when the extension cannot load the profile', async () => {
    const view = await harness(SettingsView, { extension: true });
    view.loadAuthorization.mockRejectedValue(new Error('Profile unavailable'));
    await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
    await flushPromises();
    expect(toast.info).not.toHaveBeenCalled();
    expect(view.wrapper.get('[data-testid="select-authorization-top"]').attributes('aria-pressed')).toBe(
      'true'
    );
  });

  it('shows automatic routing without a same-merchant confirmation or ownership-verification claim', async () => {
    const view = await harness(GatewayAuthorizationsPanel);
    expect(view.wrapper.text()).toContain('建议拥有两类应用的商家分别完成 TOP 和 IOP 授权');
    expect(view.wrapper.text()).toContain('TOP 授权（旧版）');
    expect(view.wrapper.text()).toContain('IOP 授权（新版）');
    expect(view.wrapper.text()).toContain('不能使用新版 IOP 应用替代');
    expect(view.wrapper.text()).toContain('系统不会替你验证店铺归属');
    expect(view.wrapper.get('[data-testid="authorization-top"]').text()).toContain('有效期未知');
    expect(view.wrapper.get('[data-testid="authorization-iop"]').text()).toContain('剩余约');
    expect(view.wrapper.find('[data-testid="confirm-authorization-binding"]').exists()).toBe(false);
    expect(view.wrapper.find('[data-testid="same-merchant-confirmation"]').exists()).toBe(false);
    expect(view.confirm).not.toHaveBeenCalled();
    expect(view.wrapper.text()).toContain('已默认启用按能力自动路由');
    expect(view.wrapper.text()).not.toContain('用户已确认同一商家');
    expect(view.current().binding.confirmed).toBe(false);
    expect(view.test).not.toHaveBeenCalled();
    expect(view.refresh).not.toHaveBeenCalled();
  });

  it('keeps automatic-routing and ownership guidance accurate in both UI languages without API calls', async () => {
    const view = await harness(GatewayAuthorizationsPanel);
    const reads = view.read.mock.calls.length;
    const statusReads = view.status.mock.calls.length;
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    const guidance = view.wrapper.get('[data-testid="authorization-binding"]').text();
    expect(guidance).toContain('Capability-based routing is enabled automatically');
    expect(guidance).toContain('With both profiles configured');
    expect(guidance).toContain('the system does not verify store ownership');
    expect(guidance).not.toMatch(/once confirmed|after confirmation|user confirmed/iu);
    expect(view.wrapper.find('[data-testid="same-merchant-confirmation"]').exists()).toBe(false);
    expect(view.read).toHaveBeenCalledTimes(reads);
    expect(view.status).toHaveBeenCalledTimes(statusReads);
    expect(view.confirm).not.toHaveBeenCalled();
    expect(view.current().binding.confirmed).toBe(false);
  });

  it.each(['missing-profile', 'unconfigured-profile', 'missing-id', 'stale-binding'] as const)(
    'derives routing availability from configured profiles rather than legacy binding: %s',
    async (caseName) => {
      const summary = dualSummary();
      if (caseName === 'missing-profile') summary.iop = null;
      else if (caseName === 'unconfigured-profile' && summary.iop) summary.iop.configured = false;
      else if (caseName === 'missing-id' && summary.top) summary.top.configurationId = null;
      else
        summary.binding = {
          confirmed: true,
          topConfigurationId: 'old-top',
          iopConfigurationId: 'old-iop',
          confirmedAtUtc: 1
        };
      const view = await harness(AlibabaAuthorizationsPanel, {
        props: { summary, selectedProtocol: 'top', canConfirm: true }
      });
      const automatic = caseName === 'missing-id' || caseName === 'stale-binding';
      expect(view.wrapper.text().includes('已默认启用按能力自动路由')).toBe(automatic);
      if (!automatic) expect(view.wrapper.text()).toContain('当前使用 TOP 授权');
      expect(view.wrapper.find('[data-testid="same-merchant-confirmation"]').exists()).toBe(false);
      expect(view.wrapper.find('[data-testid="confirm-authorization-binding"]').exists()).toBe(false);
      expect(view.confirm).not.toHaveBeenCalled();
    }
  );

  it('reloads replaced profile metadata without confirming ownership or changing the default', async () => {
    const view = await harness(GatewayAuthorizationsPanel);
    const next = dualSummary();
    if (next.iop) next.iop.configurationId = 'iop-replaced-externally';
    view.replace(next);
    const panel = view.wrapper.findComponent(GatewayAuthorizationsPanel).vm as unknown as {
      reload(): Promise<void>;
    };
    await panel.reload();
    await flushPromises();
    expect(view.read).toHaveBeenCalledTimes(2);
    expect(view.wrapper.text()).toContain('已默认启用按能力自动路由');
    expect(view.current().iop?.configurationId).toBe('iop-replaced-externally');
    expect(view.current().defaultProtocol).toBe('top');
    expect(view.current().binding.confirmed).toBe(false);
    expect(view.confirm).not.toHaveBeenCalled();
    expect(view.save).not.toHaveBeenCalled();
    expect(view.test).not.toHaveBeenCalled();
    expect(view.refresh).not.toHaveBeenCalled();
  });

  it('does not load administrator summaries for regular users', async () => {
    const view = await harness(GatewayAuthorizationsPanel, { role: 'user' });
    expect(view.read).not.toHaveBeenCalled();
    expect(view.status).not.toHaveBeenCalled();
    expect(view.wrapper.find('[data-testid="alibaba-authorizations-panel"]').exists()).toBe(false);
    expect(view.wrapper.text()).toContain('只有管理员');
  });
});

describe('protocol-targeted BFF credential actions', () => {
  it.each(['top', 'iop'] as const)('loads and saves only %s with its own revision', async (protocol) => {
    const view = await harness(GatewayCredentialPanel, { props: { protocol } });
    expect(view.status).toHaveBeenCalledWith(protocol);
    await manualSave(view.wrapper);
    expect(view.save).toHaveBeenCalledWith(
      expect.objectContaining({ protocol }),
      protocol === 'top' ? 11 : 37,
      null,
      protocol
    );
    expect(view.test).not.toHaveBeenCalled();
    expect(view.wrapper.text()).not.toContain(fixture.manual.appSecret);
    expect(view.wrapper.text()).not.toContain(fixture.manual.accessToken);
  });

  it('selects and tests IOP explicitly, without testing TOP', async () => {
    const view = await harness(GatewayAuthorizationsPanel);
    await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
    await flushPromises();
    expect(view.status).toHaveBeenLastCalledWith('iop');
    await button(view.wrapper, '测试连接').trigger('click');
    await flushPromises();
    expect(view.test.mock.calls).toEqual([['iop']]);
    expect(view.save).not.toHaveBeenCalled();
  });

  it('uses a null revision for a new IOP slot, never the TOP revision', async () => {
    const summary = dualSummary();
    summary.iop = null;
    const view = await harness(GatewayCredentialPanel, { props: { protocol: 'iop' }, summary });
    await manualSave(view.wrapper);
    expect(view.save).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'iop' }), null, null, 'iop');
    expect(view.current().top?.configurationId).toBe('top-opaque-configuration');
  });

  it('refreshes the pair and overview metadata after explicit renewal without invalidating its binding', async () => {
    const summary = dualSummary();
    summary.binding = {
      confirmed: true,
      topConfigurationId: summary.top?.configurationId ?? null,
      iopConfigurationId: summary.iop?.configurationId ?? null,
      confirmedAtUtc: 1
    };
    const view = await harness(GatewayAuthorizationsPanel, { summary });
    const changed = vi.fn();
    globalThis.addEventListener(GATEWAY_CONFIGURATION_EVENT, changed);
    try {
      await button(view.wrapper, '刷新 Token').trigger('click');
      await flushPromises();
      expect(view.refresh.mock.calls).toEqual([['top']]);
      expect(changed).toHaveBeenCalledOnce();
      expect(view.read).toHaveBeenCalledTimes(2);
      expect(view.wrapper.text()).toContain('已默认启用按能力自动路由');
      expect(view.current().binding).toEqual(summary.binding);
      expect(view.confirm).not.toHaveBeenCalled();
    } finally {
      globalThis.removeEventListener(GATEWAY_CONFIGURATION_EVENT, changed);
    }
  });

  it('imports IOP with its revision and refuses mismatched JSON without mutations', async () => {
    const view = await harness(GatewayCredentialPanel, { props: { protocol: 'iop' } });
    await importFile(view.wrapper, fixture.oauthBundle);
    expect(view.wrapper.text()).toContain('属于另一协议');
    expect(view.importCredential).not.toHaveBeenCalled();
    await importFile(view.wrapper, { ...fixture.oauthBundle, protocol: 'iop' });
    expect(view.importCredential).not.toHaveBeenCalled();
    await button(view.wrapper, '确认').trigger('click');
    await flushPromises();
    expect(view.importCredential).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'iop' }),
      37,
      null,
      'iop'
    );
    expect(view.wrapper.text()).not.toContain(fixture.manual.appSecret);
  });

  it('clears only the selected profile after confirmation and invalidates binding', async () => {
    const summary = dualSummary();
    summary.binding = {
      confirmed: true,
      topConfigurationId: summary.top?.configurationId ?? null,
      iopConfigurationId: summary.iop?.configurationId ?? null,
      confirmedAtUtc: 1
    };
    const view = await harness(GatewayAuthorizationsPanel, { summary });
    await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
    await flushPromises();
    await button(view.wrapper, '清除配置').trigger('click');
    expect(view.clear).not.toHaveBeenCalled();
    expect(view.wrapper.text()).toContain('仅清除 IOP');
    await button(view.wrapper, '确认').trigger('click');
    await flushPromises();
    expect(view.clear.mock.calls).toEqual([[37, 'iop']]);
    expect(view.current().top?.configurationId).toBe('top-opaque-configuration');
    expect(view.wrapper.text()).not.toContain('已默认启用按能力自动路由');
    expect(view.wrapper.text()).toContain('当前使用 TOP 授权');
  });

  it('keeps a failed IOP renewal and recorded expiry without replacing credentials or retrying TOP', async () => {
    const view = await harness(GatewayCredentialPanel, { props: { protocol: 'iop' } });
    view.refresh.mockRejectedValue(new Error('IOP renewal refused'));
    await button(view.wrapper, '刷新 Token').trigger('click');
    await flushPromises();
    expect(view.refresh.mock.calls).toEqual([['iop']]);
    expect(view.status.mock.calls).toEqual([['iop'], ['iop']]);
    expect(view.wrapper.text()).toContain('IOP renewal refused');
    expect(view.wrapper.get('[data-testid="credential-expiry"]').text()).toContain('有效期内');
    expect(view.save).not.toHaveBeenCalled();
    expect(view.clear).not.toHaveBeenCalled();
  });

  it('protects dirty manual edits when changing profiles', async () => {
    const view = await harness(GatewayAuthorizationsPanel);
    await button(view.wrapper, '手动填写').trigger('click');
    await view.wrapper.get('input[type="password"]').setValue('unsaved-key');
    await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
    expect(view.editing.confirmationOpen.value).toBe(true);
    view.editing.answer(false);
    await flushPromises();
    expect(view.status.mock.calls).toEqual([['top']]);
    expect((view.wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe(
      'unsaved-key'
    );
    await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
    view.editing.answer(true);
    await flushPromises();
    expect(view.status).toHaveBeenLastCalledWith('iop');
    expect(view.save).not.toHaveBeenCalled();
  });

  it('retains exact legacy call signatures when optional APIs are absent', async () => {
    const view = await harness(GatewayAuthorizationsPanel, { legacy: true });
    expect(view.wrapper.find('[data-testid="alibaba-authorizations-panel"]').exists()).toBe(false);
    expect(view.status.mock.calls).toEqual([[]]);
    await manualSave(view.wrapper);
    expect(view.save.mock.calls[0]).toHaveLength(3);
    await button(view.wrapper, '测试连接').trigger('click');
    await flushPromises();
    expect(view.test.mock.calls).toEqual([[]]);
    expect(view.read).not.toHaveBeenCalled();
  });
});

describe('extension settings profile isolation', () => {
  it('cancels renewal protocol selection without loading or refreshing an authorization', async () => {
    const view = await harness(SettingsView, { extension: true });
    const reads = view.settingsSummary.mock.calls.length;
    await view.wrapper.get('[data-testid="renew-authorization-top"]').trigger('click');
    await view.wrapper.get('[data-testid="cancel-authorization-protocol"]').trigger('click');
    await flushPromises();
    expect(view.settingsSummary).toHaveBeenCalledTimes(reads);
    expect(view.loadAuthorization).not.toHaveBeenCalled();
    expect(view.refreshAuthorization).not.toHaveBeenCalled();
    expect(view.confirmAuthorizations).not.toHaveBeenCalled();
  });

  it('loads the selected IOP profile before editing and saving; the TOP profile remains intact', async () => {
    const view = await harness(SettingsView, { extension: true });
    await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
    await flushPromises();
    expect(view.loadAuthorization).toHaveBeenCalledWith('iop');
    expect((view.wrapper.get('input[aria-label="App Key"]').element as HTMLInputElement).value).toBe(
      'iop-key'
    );
    await view.wrapper.get('input[aria-label="App Secret"]').setValue('new-iop-secret');
    await view.wrapper.get('input[aria-label="Access Token"]').setValue('new-iop-token');
    await button(view.wrapper, '保存设置').trigger('click');
    await flushPromises();
    expect(view.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT })
    );
    expect(view.current().top?.configurationId).toBe('top-opaque-configuration');
    expect(view.loadAuthorization).toHaveBeenLastCalledWith('iop');
    expect(view.save).not.toHaveBeenCalled();
  });

  it('loads the JSON metadata profile before import and saves only that profile', async () => {
    const view = await harness(SettingsView, { extension: true });
    await importFile(view.wrapper, {
      ...fixture.oauthBundle,
      protocol: 'iop',
      oauth: {
        ...fixture.oauthBundle.oauth,
        refreshToken: 'fixture-iop-refresh',
        refreshExpiresAtUtc: fixture.knownExpiry
      }
    });
    expect(view.loadAuthorization.mock.calls).toEqual([['iop']]);
    expect(view.saveSettings).not.toHaveBeenCalled();
    await button(view.wrapper, '保存设置').trigger('click');
    await flushPromises();
    expect(view.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'iop',
        refreshToken: 'fixture-iop-refresh',
        refreshTokenExpiresTimeUtc: Date.parse(fixture.knownExpiry)
      })
    );
    expect(view.wrapper.text()).not.toContain('fixture-iop-refresh');
    expect(view.current().top?.configurationId).toBe('top-opaque-configuration');
    expect(view.current().binding.confirmed).toBe(false);
  });

  it('automatically routes local grants without confirming ownership, targeting renewal/clear separately', async () => {
    const view = await harness(SettingsView, { extension: true });
    expect(view.wrapper.text()).toContain('已默认启用按能力自动路由');
    expect(view.wrapper.find('[data-testid="same-merchant-confirmation"]').exists()).toBe(false);
    expect(view.wrapper.find('[data-testid="confirm-authorization-binding"]').exists()).toBe(false);
    expect(view.confirmAuthorizations).not.toHaveBeenCalled();
    expect(view.current().binding.confirmed).toBe(false);
    await view.wrapper.get('[data-testid="renew-authorization-iop"]').trigger('click');
    await flushPromises();
    expect(view.refreshAuthorization).not.toHaveBeenCalled();
    await view.wrapper.get('[data-testid="choose-authorization-iop"]').trigger('click');
    await flushPromises();
    expect(view.refreshAuthorization.mock.calls).toEqual([['iop']]);
    await view.wrapper.get('[data-testid="clear-authorization-iop"]').trigger('click');
    await flushPromises();
    expect(view.clearAuthorization).not.toHaveBeenCalled();
    await button(view.wrapper, '确认').trigger('click');
    await flushPromises();
    expect(view.clearAuthorization.mock.calls).toEqual([['iop']]);
    expect(view.current().top?.configurationId).toBe('top-opaque-configuration');
    expect(view.current().defaultProtocol).toBe('top');
    expect(view.wrapper.text()).not.toContain('已默认启用按能力自动路由');
    expect(view.wrapper.text()).toContain('当前使用 TOP 授权');
    expect(view.confirmAuthorizations).not.toHaveBeenCalled();
  });

  it('guards unsaved profile edits and preserves them after a failed renewal', async () => {
    const view = await harness(SettingsView, { extension: true });
    await view.wrapper.get('input[aria-label="App Secret"]').setValue('unsaved-top-secret');
    await view.wrapper.get('[data-testid="select-authorization-iop"]').trigger('click');
    expect(view.editing.confirmationOpen.value).toBe(true);
    view.editing.answer(false);
    await flushPromises();
    expect(view.loadAuthorization).not.toHaveBeenCalled();
    view.refreshAuthorization.mockRejectedValue(new Error('Renewal denied'));
    await view.wrapper.get('[data-testid="renew-authorization-iop"]').trigger('click');
    await view.wrapper.get('[data-testid="choose-authorization-iop"]').trigger('click');
    view.editing.answer(false);
    await flushPromises();
    expect(view.refreshAuthorization).not.toHaveBeenCalled();
    expect((view.wrapper.get('input[aria-label="App Secret"]').element as HTMLInputElement).value).toBe(
      'unsaved-top-secret'
    );
  });

  it('does not read authorization metadata while the vault is locked', async () => {
    const view = await harness(SettingsView, { extension: true, locked: true });
    expect(view.settingsSummary).not.toHaveBeenCalled();
    expect(view.loadAuthorization).not.toHaveBeenCalled();
    expect(view.load).not.toHaveBeenCalled();
    expect(view.wrapper.find('[data-testid="alibaba-authorizations-panel"]').exists()).toBe(false);
  });

  it('preserves both profiles and expiry after a local renewal refusal', async () => {
    const view = await harness(SettingsView, { extension: true });
    view.refreshAuthorization.mockRejectedValue(new Error('IOP renewal refused'));
    await view.wrapper.get('[data-testid="renew-authorization-iop"]').trigger('click');
    await view.wrapper.get('[data-testid="choose-authorization-iop"]').trigger('click');
    await flushPromises();
    expect(view.refreshAuthorization.mock.calls).toEqual([['iop']]);
    expect(view.wrapper.text()).toContain('IOP renewal refused');
    expect(view.wrapper.get('[data-testid="authorization-iop"]').text()).toContain('有效期内');
    expect(view.current().top?.configurationId).toBe('top-opaque-configuration');
    expect(view.current().iop?.configurationId).toBe('iop-opaque-configuration');
    expect(view.clearAuthorization).not.toHaveBeenCalled();
    expect(view.saveSettings).not.toHaveBeenCalled();
  });

  it('keeps the legacy extension editor unchanged when optional repository methods are absent', async () => {
    const view = await harness(SettingsView, { extension: true, legacy: true });
    expect(view.wrapper.find('[data-testid="alibaba-authorizations-panel"]').exists()).toBe(false);
    expect(view.load).toHaveBeenCalledOnce();
    await view.wrapper.get('select[aria-label="网关协议"]').setValue('iop');
    await button(view.wrapper, '保存设置').trigger('click');
    await flushPromises();
    expect(view.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'iop' }));
    expect(view.loadAuthorization).not.toHaveBeenCalled();
    expect(view.settingsSummary).not.toHaveBeenCalled();
    expect(view.load).toHaveBeenCalledTimes(2);
  });
});

describe('overview independent expiries and explicit renewal', () => {
  it.each([false, true])(
    'shows both independent lifetimes in extension=%s, without locale/time API calls',
    async (extension) => {
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      const view = await harness(DashboardAuthorizationCard, { extension });
      expect(view.wrapper.get('[data-testid="authorization-top"]').text()).toContain('未知');
      expect(view.wrapper.get('[data-testid="authorization-iop"]').text()).toContain('30 天');
      expect(view.wrapper.findAll('button')).toHaveLength(0);
      expect(view.wrapper.text()).not.toContain('Access Token');
      expect(view.wrapper.text()).not.toContain('Refresh Token');
      expect(view.wrapper.get('[data-testid="dashboard-dual-authorizations"]').classes()).toContain(
        'grid-cols-2'
      );
      const readCount = extension ? view.settingsSummary.mock.calls.length : view.read.mock.calls.length;
      uiI18n.global.locale.value = 'en-US';
      await vi.advanceTimersByTimeAsync(60_000);
      await flushPromises();
      expect(view.wrapper.get('[data-testid="authorization-top"]').text()).toContain('Unknown');
      expect(view.wrapper.get('[data-testid="authorization-iop"]').text()).toContain('29 days');
      expect(extension ? view.settingsSummary.mock.calls.length : view.read.mock.calls.length).toBe(
        readCount
      );
      expect(view.refresh).not.toHaveBeenCalled();
      expect(view.refreshAuthorization).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'renews only IOP in extension=%s and preserves the profile after failure',
    async (extension) => {
      const view = await harness(DashboardAuthorizationAction, { extension, props: { protocol: 'iop' } });
      view.refresh.mockRejectedValue(new Error('Renewal refused'));
      view.refreshAuthorization.mockRejectedValue(new Error('Renewal refused'));
      await view.wrapper.get('[data-testid="dashboard-renew-authorization-iop"]').trigger('click');
      expect(view.refresh).not.toHaveBeenCalled();
      expect(view.refreshAuthorization).not.toHaveBeenCalled();
      expect(view.status).not.toHaveBeenCalled();
      await view.wrapper.get('[data-testid="choose-authorization-iop"]').trigger('click');
      await flushPromises();
      expect(view.wrapper.text()).toContain('选择新版 IOP 重新授权');
      await button(view.wrapper, '刷新 Token').trigger('click');
      await flushPromises();
      expect(extension ? view.refreshAuthorization.mock.calls : view.refresh.mock.calls).toEqual([['iop']]);
      expect(view.wrapper.text()).toContain('Renewal refused');
      expect(view.wrapper.find('[role="dialog"]').exists()).toBe(true);
      expect(view.current().iop?.configurationId).toBe('iop-opaque-configuration');
      expect(view.save).not.toHaveBeenCalled();
      expect(view.clear).not.toHaveBeenCalled();
    }
  );

  it('refreshes dual metadata only on a configuration event and keeps both grants independent', async () => {
    const view = await harness(DashboardAuthorizationCard);
    const next = dualSummary();
    next.iop = null;
    view.replace(next);
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await flushPromises();
    expect(view.read).toHaveBeenCalledTimes(2);
    expect(view.wrapper.find('[data-testid="dashboard-dual-authorizations"]').exists()).toBe(false);
    expect(view.wrapper.text()).toContain('未知');
    expect(view.wrapper.get('[data-testid="authorization-details"]').attributes('aria-label')).toContain(
      '有效期未知'
    );
  });

  it('keeps compact dual countdown colors and expiry details without rendering settings actions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const summary = dualSummary();
    if (!summary.iop || !summary.top) throw new Error('Missing fixture profiles');
    const day = 86_400_000;
    summary.top.accessTokenCapturedTimeUtc = Date.now() - 60 * day;
    summary.top.accessTokenExpiresTimeUtc = Date.now() + 40 * day;
    summary.iop.accessTokenCapturedTimeUtc = Date.now() - 80 * day;
    summary.iop.accessTokenExpiresTimeUtc = Date.now() + 20 * day;
    const view = await harness(DashboardAuthorizationCard, { summary });
    expect(
      view.wrapper.get('[data-testid="authorization-top"] [role="status"]').attributes('data-tone')
    ).toBe('warning');
    expect(
      view.wrapper.get('[data-testid="authorization-iop"] [role="status"]').attributes('data-tone')
    ).toBe('danger');
    expect(view.wrapper.get('[data-testid="authorization-details"]').attributes('aria-label')).toContain(
      'Access Token'
    );
    expect(view.wrapper.text()).not.toContain('Access Token');
    expect(view.wrapper.text().length).toBeLessThan(70);
    expect(view.wrapper.findAll('button')).toHaveLength(0);
    expect(view.read).toHaveBeenCalledOnce();
    expect(view.status).not.toHaveBeenCalled();
  });

  it.each(['top', 'iop'] as const)(
    'preserves the single-profile card and expiry tooltip for %s metadata',
    async (protocol) => {
      const summary = dualSummary();
      summary[protocol === 'top' ? 'iop' : 'top'] = null;
      const selected = summary[protocol];
      if (selected) selected.accessTokenExpiresTimeUtc = Date.parse(fixture.knownExpiry);
      const view = await harness(DashboardAuthorizationCard, { summary, extension: true });
      expect(view.wrapper.find('[data-testid="dashboard-dual-authorizations"]').exists()).toBe(false);
      expect(view.wrapper.get('[role="status"]').classes()).toContain('text-3xl');
      expect(view.wrapper.findAll('button')).toHaveLength(0);
      expect(view.wrapper.get('[data-testid="authorization-details"]').attributes('aria-label')).toContain(
        '2030-01-02'
      );
      expect(view.wrapper.find('[data-testid="dashboard-renew-authorization-top"]').exists()).toBe(false);
      expect(view.wrapper.find('[data-testid="dashboard-renew-authorization-iop"]').exists()).toBe(false);
    }
  );

  it.each([false, true])(
    'targets the IOP-only profile from the unchanged global renewal action (extension=%s)',
    async (extension) => {
      const summary = dualSummary();
      summary.top = null;
      const view = await harness(DashboardAuthorizationAction, { summary, extension });
      await view.wrapper.get('[data-testid="dashboard-renew-authorization"]').trigger('click');
      expect(view.status).not.toHaveBeenCalled();
      expect(view.refreshAuthorization).not.toHaveBeenCalled();
      await view.wrapper.get('[data-testid="choose-authorization-iop"]').trigger('click');
      await flushPromises();
      expect(view.wrapper.text()).toContain('选择新版 IOP 重新授权');
      await button(view.wrapper, '刷新 Token').trigger('click');
      await flushPromises();
      expect(extension ? view.refreshAuthorization.mock.calls : view.refresh.mock.calls).toEqual([['iop']]);
      if (!extension) expect(view.status.mock.calls).toEqual([['iop']]);
    }
  );
});
