// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { config, flushPromises, shallowMount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALIBABA_GATEWAY,
  createBffAuthenticationEvents,
  type ControlClient,
  type ControlSession
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import OneVegetableApp from '../src/OneVegetableApp.vue';
import AccountMenu from '../src/components/AccountMenu.vue';
import AuthGate from '../src/components/AuthGate.vue';
import AlibabaAuthorizationProtocolDialog from '../src/components/AlibabaAuthorizationProtocolDialog.vue';
import { appHash, PAGE_IDS, pageHash, parseAppHash } from '../src/lib/hash-router';

vi.mock('../src/views/DashboardView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/ProductsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/InventoryView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/PhotosView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/RfqsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/OrdersView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/LogisticsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/InsightsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/CapabilitiesView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/AdminView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/ReleaseNotesView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/views/SettingsView.vue', () => ({ default: { template: '<div />' } }));

const settings = {
  load: () =>
    Promise.resolve({
      appKey: '',
      appSecret: '',
      accessToken: '',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac' as const
    }),
  save: () => Promise.resolve()
};

beforeEach(() => {
  config.global.plugins = [
    [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]
  ];
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
});

afterEach(() => {
  globalThis.history.replaceState(null, '', '#/dashboard');
  vi.unstubAllGlobals();
});

describe('OneVegetableApp hash navigation', () => {
  it.each(['legacy', 'top', 'iop', 'cancel'] as const)(
    'chooses the extension authorization protocol after onboarding (%s)',
    async (choice) => {
      globalThis.history.replaceState(null, '', '#/dashboard');
      const OnboardingStub = defineComponent({
        emits: { ready: (_destination?: 'credential-acquisition') => true },
        setup(_props, { emit }) {
          return () =>
            h(
              'button',
              {
                'data-testid': 'finish-onboarding',
                onClick: () => {
                  emit('ready', 'credential-acquisition');
                }
              },
              '开始授权向导'
            );
        }
      });
      const AcquisitionStub = defineComponent({
        props: { open: { type: Boolean, required: true } },
        template: '<div v-if="open" data-testid="extension-credential-acquisition" />'
      });
      const ReviewPromptStub = defineComponent({
        setup() {
          return () => h('div', { 'data-testid': 'review-prompt' });
        }
      });
      const StartupStub = defineComponent({
        emits: ['ready'],
        template: '<button data-testid="finish-startup" @click="$emit(\'ready\')">Ready</button>'
      });
      let selecting = false;
      const openTool = vi.fn(() => {
        expect(selecting).toBe(true);
        return Promise.resolve();
      });
      const wrapper = shallowMount(OneVegetableApp, {
        props: {
          gateway: new MockGatewayClient(0),
          settings,
          onboarding: {
            load: () => Promise.resolve({ version: 1 as const, completedAt: null }),
            complete: () => Promise.resolve({ version: 1 as const, completedAt: '2026-08-28T00:00:00.000Z' })
          },
          reviewPrompt: {
            claimDuePrompt: () => Promise.resolve(false),
            openStoreReview: () => Promise.resolve()
          },
          alibabaCredentialAcquisition: (choice === 'legacy' ? {} : { openTool }) as never,
          mode: 'extension'
        },
        global: {
          stubs: {
            AlibabaCredentialAcquisitionDialog: AcquisitionStub,
            ExtensionReviewPrompt: ReviewPromptStub,
            WorkbenchStartupDialogs: StartupStub,
            OnboardingDialog: OnboardingStub
          }
        }
      });

      expect(wrapper.find('nav').exists()).toBe(false);
      expect(wrapper.find('[data-testid="review-prompt"]').exists()).toBe(false);
      await wrapper.get('[data-testid="finish-onboarding"]').trigger('click');
      await flushPromises();

      expect(globalThis.location.hash).toBe('#/dashboard');
      expect(wrapper.get('nav a[href="#/dashboard"]').attributes('aria-current')).toBe('page');
      const chooser = wrapper.getComponent(AlibabaAuthorizationProtocolDialog);
      const chooserVm = chooser.vm as unknown as {
        $emit(event: 'select', protocol: 'top' | 'iop'): void;
        $emit(event: 'update:open', open: boolean): void;
      };
      expect(chooser.props('open')).toBe(true);
      expect(wrapper.find('[data-testid="extension-credential-acquisition"]').exists()).toBe(false);
      expect(openTool).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="review-prompt"]').exists()).toBe(false);
      if (choice === 'cancel') chooserVm.$emit('update:open', false);
      else {
        selecting = true;
        chooserVm.$emit('select', choice === 'legacy' ? 'top' : choice);
        selecting = false;
      }
      await flushPromises();
      if (choice === 'legacy') {
        expect(wrapper.find('[data-testid="extension-credential-acquisition"]').exists()).toBe(true);
        wrapper.getComponent(AcquisitionStub).vm.$emit('update:open', false);
      } else if (choice !== 'cancel') {
        expect(openTool.mock.calls).toEqual([[choice]]);
        expect(wrapper.find('[data-testid="extension-credential-acquisition"]').exists()).toBe(false);
      } else expect(openTool).not.toHaveBeenCalled();
      await flushPromises();
      expect(wrapper.find('[data-testid="review-prompt"]').exists()).toBe(false);
      await wrapper.get('[data-testid="finish-startup"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-testid="review-prompt"]').exists()).toBe(true);
      wrapper.unmount();
    }
  );

  it('guides a signed-in self-hosted administrator into the cloud authorization assistant', async () => {
    const openTool = vi.fn();
    const OnboardingStub = defineComponent({
      emits: { ready: (_destination?: 'credential-acquisition') => true },
      setup(_props, { emit }) {
        return () =>
          h(
            'button',
            {
              'data-testid': 'finish-cloud-onboarding',
              onClick: () => {
                emit('ready', 'credential-acquisition');
              }
            },
            '开始授权向导'
          );
      }
    });
    const CloudAcquisitionStub = defineComponent({
      props: { open: { type: Boolean, required: true } },
      template: '<div v-if="open" data-testid="cloud-credential-acquisition" />'
    });
    const wrapper = shallowMount(OneVegetableApp, {
      props: {
        gateway: new MockGatewayClient(0),
        settings,
        onboarding: {
          load: () => Promise.resolve({ version: 1 as const, completedAt: null }),
          complete: () => Promise.resolve({ version: 1 as const, completedAt: '2026-09-04T00:00:00.000Z' })
        },
        control: adminControl(),
        alibabaCredentialAcquisition: { openTool } as never,
        mode: 'bff'
      },
      global: {
        stubs: {
          AlibabaCloudCredentialAcquisitionDialog: CloudAcquisitionStub,
          OnboardingDialog: OnboardingStub
        }
      }
    });
    await flushPromises();

    expect(wrapper.find('nav').exists()).toBe(false);
    await wrapper.get('[data-testid="finish-cloud-onboarding"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="cloud-credential-acquisition"]').attributes('data-testid')).toBe(
      'cloud-credential-acquisition'
    );
    expect(wrapper.find('nav').exists()).toBe(true);
    expect(wrapper.findComponent(AlibabaAuthorizationProtocolDialog).exists()).toBe(false);
    expect(openTool).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('renders stable links and follows hash changes', async () => {
    globalThis.history.replaceState(null, '', '#/products/publisher/guided/details/product-1');
    const wrapper = shallowMount(OneVegetableApp, {
      props: {
        gateway: new MockGatewayClient(0),
        settings,
        mode: 'mock'
      }
    });
    await flushPromises();

    expect(wrapper.get('nav').attributes('aria-label')).toBe('主导航');
    expect(wrapper.get('aside').attributes('aria-hidden')).toBe('true');
    expect(wrapper.get('aside').attributes('inert')).toBe('true');
    expect(wrapper.get('[aria-label="打开主导航"]').attributes('aria-controls')).toBe(
      'app-primary-navigation'
    );
    const links = wrapper.findAll('nav a');
    expect(links.map((link) => link.attributes('href'))).toEqual(
      PAGE_IDS.filter((page) => page !== 'admin').map(pageHash)
    );
    expect(wrapper.get('nav a[href="#/products"]').attributes('aria-current')).toBe('page');
    expect(globalThis.location.hash).toBe('#/products/publisher/guided/details/product-1');

    globalThis.history.replaceState(null, '', '#/orders');
    globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();

    expect(wrapper.get('nav a[href="#/orders"]').attributes('aria-current')).toBe('page');
    expect(wrapper.get('nav a[href="#/products"]').attributes('aria-current')).toBeUndefined();
    wrapper.unmount();
  });

  it('encodes and parses deep route segments without changing the page identity', () => {
    const hash = appHash('orders', 'orders', 'order/with spaces', 'payment');
    expect(hash).toBe('#/orders/orders/order%2Fwith%20spaces/payment');
    expect(parseAppHash(hash)).toEqual({
      page: 'orders',
      segments: ['orders', 'order/with spaces', 'payment']
    });
  });

  it('canonicalizes an unknown path to the dashboard', async () => {
    globalThis.history.replaceState(null, '', '#/missing');
    const wrapper = shallowMount(OneVegetableApp, {
      props: {
        gateway: new MockGatewayClient(0),
        settings,
        mode: 'mock'
      }
    });
    await flushPromises();

    expect(globalThis.location.hash).toBe('#/dashboard');
    expect(wrapper.get('nav a[href="#/dashboard"]').attributes('aria-current')).toBe('page');
    wrapper.unmount();
  });

  it('rejects the admin path for a regular BFF user', async () => {
    globalThis.history.replaceState(null, '', '#/admin');
    const TooltipStub = defineComponent({
      props: { text: { type: String, required: true } },
      template: '<span><slot /></span>'
    });
    const wrapper = shallowMount(OneVegetableApp, {
      props: {
        gateway: new MockGatewayClient(0),
        settings,
        control: regularUserControl(),
        mode: 'bff'
      },
      global: { stubs: { Tooltip: TooltipStub } }
    });
    await flushPromises();

    expect(globalThis.location.hash).toBe('#/dashboard');
    expect(wrapper.find('nav a[href="#/admin"]').exists()).toBe(false);
    expect(wrapper.findComponent(AccountMenu).props('name')).toBe('member');
    expect(wrapper.findComponent(AccountMenu).props('canLogout')).toBe(true);
    wrapper.unmount();
  });

  it('prompts once for an expired session and preserves the current route for sign-in', async () => {
    globalThis.history.replaceState(null, '', '#/products');
    const authenticationEvents = createBffAuthenticationEvents();
    const SessionExpiredStub = defineComponent({
      props: { open: { type: Boolean, required: true } },
      emits: { reauthenticate: () => true },
      template:
        '<button v-if="open" data-testid="session-expired-login" @click="$emit(\'reauthenticate\')">重新登录</button>'
    });
    const wrapper = shallowMount(OneVegetableApp, {
      props: {
        gateway: new MockGatewayClient(0),
        settings,
        control: regularUserControl(),
        authenticationEvents,
        mode: 'bff'
      },
      global: { stubs: { SessionExpiredDialog: SessionExpiredStub } }
    });
    await flushPromises();

    authenticationEvents.notify({
      code: 'SESSION_EXPIRED',
      requestId: '86f96b63-2f45-4ae5-9362-9e74ab35d5a2'
    });
    authenticationEvents.notify({
      code: 'SESSION_INVALID',
      requestId: '3d7c8523-93cc-48b7-a615-a23d2976c516'
    });
    await flushPromises();

    const dialog = wrapper.findComponent(SessionExpiredStub);
    expect(dialog.props('open')).toBe(true);
    expect(wrapper.find('nav').exists()).toBe(true);
    expect(globalThis.location.hash).toBe('#/products');

    await wrapper.get('[data-testid="session-expired-login"]').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(AuthGate).exists()).toBe(true);
    expect(wrapper.find('nav').exists()).toBe(false);
    expect(globalThis.location.hash).toBe('#/products');
    expect(wrapper.findComponent(SessionExpiredStub).props('open')).toBe(false);
    wrapper.unmount();
  });
});

function regularUserControl(): ControlClient {
  const session: ControlSession = {
    principal: { actorId: 'user-1', username: 'member', role: 'user', source: 'bff' },
    user: {
      id: 'user-1',
      username: 'member',
      role: 'user',
      status: 'active',
      lockedUntilUtc: null,
      createTimeUtc: 1,
      updateTimeUtc: 1,
      creatorId: 'system:bootstrap',
      updaterId: 'system:bootstrap',
      revision: 1,
      remark: null
    },
    absoluteExpiresTimeUtc: 10_000,
    idleExpiresTimeUtc: 5_000
  };
  return {
    backendMeta: () =>
      Promise.resolve({
        runtime: 'node',
        database: 'sqlite',
        environment: 'test',
        gatewayMode: 'replay',
        apiPrefix: '/api/v1',
        version: '2.0.1'
      }),
    session: () => Promise.resolve(session)
  } as unknown as ControlClient;
}

function adminControl(): ControlClient {
  const session: ControlSession = {
    principal: { actorId: 'admin-1', username: 'administrator', role: 'admin', source: 'bff' },
    user: {
      id: 'admin-1',
      username: 'administrator',
      role: 'admin',
      status: 'active',
      lockedUntilUtc: null,
      createTimeUtc: 1,
      updateTimeUtc: 1,
      creatorId: 'system:bootstrap',
      updaterId: 'system:bootstrap',
      revision: 1,
      remark: null
    },
    absoluteExpiresTimeUtc: 10_000,
    idleExpiresTimeUtc: 5_000
  };
  return {
    backendMeta: () =>
      Promise.resolve({
        runtime: 'cloudflare',
        database: 'd1',
        environment: 'self-hosted',
        gatewayMode: 'disabled',
        apiPrefix: '/api/v1',
        version: '2.2.1'
      }),
    session: () => Promise.resolve(session)
  } as unknown as ControlClient;
}
