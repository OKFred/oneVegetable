// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findCapability,
  getCapabilityDefinition,
  GatewayException,
  type ApiCapability,
  type CapabilityDefinition,
  type GatewayClient,
  type OperationId,
  type RequestOf,
  type ResponseOf
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import CapabilitiesView from '../src/views/CapabilitiesView.vue';
import { provideServices, type AppServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';

const mounted: { unmount(): void }[] = [];
const queryClients: QueryClient[] = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  for (const client of queryClients.splice(0)) client.clear();
  document.body.innerHTML = '';
  uiI18n.global.locale.value = 'zh-CN';
  vi.restoreAllMocks();
});

function mountView(mode: AppServices['mode'], gateway: GatewayClient, runtime?: AppServices['runtime']) {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        settings: {
          load: () =>
            Promise.resolve({
              appKey: '',
              appSecret: '',
              accessToken: '',
              endpoint: '',
              signMethod: 'hmac' as const
            }),
          save: () => Promise.resolve()
        },
        mode,
        ...(runtime ? { runtime } : {})
      });
      return () => h(CapabilitiesView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
  mounted.push(wrapper);
  return wrapper;
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

describe('CapabilitiesView call gates and errors (no network)', () => {
  it.each(['general', 'conditional'] as const)(
    'loads disabled restricted definitions and translates %s scope',
    async (businessScope) => {
      const fixture = fixtureGateway(
        {
          enabled: false,
          restricted: true,
          restrictionReason: 'Requires fixture-seller permission and qualification'
        },
        {
          metadata: { businessScope, permissionGroups: ['fixture-seller'] },
          definitionMetadata: {
            requestExample: { seller: 'fixture-seller' },
            responseExample: { documentedOnly: true },
            errorCodes: [{ code: 'SCOPE_REQUIRED', message: 'Seller permission required' }]
          }
        }
      );
      const wrapper = mountView('extension', fixture.gateway);
      await openFixture(wrapper);
      expect(bodyText()).toContain('已类型化');
      expect(bodyText()).toContain('Requires fixture-seller permission and qualification');
      expect(bodyText()).toContain(businessScope === 'general' ? '通用业务' : '需业务资格');
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('API 目录');
      expect(document.body.querySelector('textarea')?.value).toContain('fixture-seller');
      expect(bodyText()).toContain('documentedOnly');
      expect(bodyText()).toContain('SCOPE_REQUIRED');
      expect(bodyText()).toContain('不是调用结果');
      expect(fixture.request).toHaveBeenCalledWith('getCapabilityDefinition', { method: fixture.method });
      expect(callButton().disabled).toBe(true);
    }
  );

  it('shows definition errors even for disabled restricted contracts', async () => {
    const fixture = fixtureGateway(
      { enabled: false, restricted: true },
      {
        failure: { operation: 'getCapabilityDefinition', error: new Error('restricted definition failed') }
      }
    );
    const wrapper = mountView('extension', fixture.gateway);
    await openFixture(wrapper);
    expect(bodyText()).toContain('restricted definition failed');
    expect(callButton().disabled).toBe(true);
  });
  for (const mode of ['bff', 'extension'] as const) {
    it.each([
      { restricted: true },
      { realCallEnabled: false },
      { risk: 'mutation' },
      { method: 'wrong.definition' }
    ])(`${mode} also honors definition safeguards: %j`, async (definitionMetadata) => {
      const fixture = fixtureGateway({}, { definitionMetadata });
      const wrapper = mountView(mode, fixture.gateway, realRuntime());
      await openFixture(wrapper);
      expect(callButton().disabled).toBe(true);
      expect(fixture.request.mock.calls.some(([operation]) => operation === 'callCapability')).toBe(false);
    });
    it.each<Partial<ApiCapability>>([
      { realCallEnabled: false, risk: 'read' },
      { realCallEnabled: false, risk: 'mutation' },
      { restricted: true, restrictionReason: 'fixture business restriction' },
      { risk: 'mutation', realCallEnabled: true },
      { jushitaOnly: true },
      { enabled: false }
    ])(`${mode} blocks %j without dispatching a call`, async (overrides) => {
      const fixture = fixtureGateway(overrides);
      const wrapper = mountView(mode, fixture.gateway, realRuntime());
      await openFixture(wrapper);
      expect(callButton().disabled).toBe(true);
      callButton().click();
      await flushPromises();
      expect(fixture.request.mock.calls.map(([operation]) => operation)).toEqual([
        'listCapabilities',
        'getCapabilityDefinition'
      ]);
    });

    it(`${mode} preserves deprecated reads with an advisory warning`, async () => {
      const fixture = fixtureGateway({ lifecycle: 'deprecated' });
      const wrapper = mountView(mode, fixture.gateway, realRuntime());
      await openFixture(wrapper);
      expect(bodyText()).toContain('废弃状态仅为警告');
      expect(callButton().disabled).toBe(false);
      callButton().click();
      await vi.waitFor(() => {
        expect(bodyText()).toContain('fixture-only-response');
      });
    });
  }

  it.each(['mock', 'bff'] as const)(
    '%s explicitly allows mock examples with closed real calls',
    async (mode) => {
      const fixture = fixtureGateway({ realCallEnabled: false, lifecycle: 'deprecated' });
      const runtime = realRuntime();
      runtime.backendMeta.gatewayMode = 'mock';
      const wrapper = mountView(mode, fixture.gateway, runtime);
      await openFixture(wrapper);
      expect(callButton().disabled).toBe(false);
      callButton().click();
      await vi.waitFor(() => {
        expect(bodyText()).toContain('fixture-only-response');
      });
      expect(fixture.request).toHaveBeenCalledWith('callCapability', {
        method: fixture.method,
        parameters: {}
      });
    }
  );

  it.each(['loading', 'error'] as const)(
    'does not fall back to mock when runtime metadata is %s',
    async (metaStatus) => {
      const fixture = fixtureGateway();
      const wrapper = mountView('bff', fixture.gateway, { metaStatus, backendMeta: null });
      await openFixture(wrapper);
      expect(callButton().disabled).toBe(true);
      expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain('Mock 数据');
    }
  );

  it('renders optional metadata as catalog evidence, including definition-only metadata', async () => {
    const fixture = fixtureGateway(
      {},
      {
        definitionMetadata: {
          permissionGroups: [' Seller ', 'Seller', '', 12],
          businessScope: 'International seller'
        },
        metadata: { permissionGroups: undefined, businessScope: undefined }
      }
    );
    const wrapper = mountView('mock', fixture.gateway);
    await openFixture(wrapper);
    const metadata = document.body.querySelector('section[aria-label="权限与业务元数据"]');
    expect(metadata?.textContent).toContain('Seller');
    expect(metadata?.textContent).toContain('International seller');
    expect(metadata?.querySelector('dd')?.textContent.trim()).toBe('Seller');
    expect(metadata?.textContent).toContain('不代表当前账号已获得授权');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(bodyText()).toContain('Documented permission groups');
    expect(bodyText()).toContain('Business scope');
    expect(bodyText()).toContain('Current environment');
    expect(bodyText()).not.toContain('capabilities.metadata.');
  });

  it('shows catalog metadata without interpreting it as an account grant', async () => {
    const fixture = fixtureGateway(
      { realCallEnabled: false },
      {
        metadata: { permissionGroups: ['seller-read'], businessScope: 'Seller catalog' }
      }
    );
    const wrapper = mountView('extension', fixture.gateway);
    await openFixture(wrapper);
    expect(bodyText()).toContain('seller-read');
    expect(bodyText()).toContain('Seller catalog');
    expect(callButton().disabled).toBe(true);
  });

  it('omits metadata when absent instead of suggesting unrestricted access', async () => {
    const fixture = fixtureGateway(
      {},
      {
        metadata: { permissionGroups: undefined, businessScope: undefined },
        definitionMetadata: { permissionGroups: undefined, businessScope: undefined }
      }
    );
    const wrapper = mountView('mock', fixture.gateway);
    await openFixture(wrapper);
    expect(document.body.querySelector('section[aria-label="权限与业务元数据"]')).toBeNull();
  });

  for (const mode of ['bff', 'extension'] as const) {
    it.each(['listCapabilities', 'getCapabilityDefinition', 'callCapability'] as const)(
      `${mode} surfaces %s errors without mock fallback`,
      async (operation) => {
        const failure = new GatewayException({
          code: 'FIXTURE_API_ERROR',
          message: 'fixture API failure',
          retryable: false,
          traceId: 'fixture-error-trace'
        });
        const fixture = fixtureGateway({}, { failure: { operation, error: failure } });
        const fallback = vi.spyOn(MockGatewayClient.prototype, 'request');
        const wrapper = mountView(mode, fixture.gateway, realRuntime());
        if (operation !== 'listCapabilities') {
          await openFixture(wrapper);
          if (operation === 'callCapability') {
            expect(callButton().disabled).toBe(false);
            callButton().click();
          }
        }
        await vi.waitFor(() => {
          expect(bodyText()).toContain('fixture API failure');
        });
        expect(bodyText()).toContain('fixture-error-trace');
        expect(bodyText()).not.toContain('fixture-only-response');
        expect(fallback).not.toHaveBeenCalled();
        expect(fixture.request.mock.calls.filter(([id]) => id === operation)).toHaveLength(1);
        if (operation === 'getCapabilityDefinition') expect(callButton().disabled).toBe(true);
      }
    );
  }
});

function realRuntime() {
  return {
    metaStatus: 'ready' as const,
    backendMeta: {
      apiPrefix: '/api/v1',
      runtime: 'node' as const,
      environment: 'ui-test',
      database: 'sqlite' as const,
      gatewayMode: 'real' as 'real' | 'mock',
      version: 'test'
    }
  };
}

function fixtureGateway(
  overrides: Partial<ApiCapability> = {},
  options: {
    metadata?: Record<string, unknown>;
    definitionMetadata?: Record<string, unknown>;
    failure?: { operation: OperationId; error: Error };
  } = {}
) {
  const method = 'alibaba.icbu.product.list';
  const base = findCapability(method);
  const baseDefinition = getCapabilityDefinition(method);
  if (!base || !baseDefinition) throw new Error('Missing product list fixture');
  const capability: ApiCapability = { ...base, ...overrides, ...options.metadata };
  const definition: CapabilityDefinition = {
    ...baseDefinition,
    requestExample: {},
    ...options.definitionMetadata
  };
  const request = vi.fn<GatewayClient['request']>(
    async <K extends OperationId>(operation: K, _payload: RequestOf<K>): Promise<ResponseOf<K>> => {
      await Promise.resolve();
      if (operation === options.failure?.operation) throw options.failure.error;
      if (operation === 'listCapabilities') return [capability] as ResponseOf<K>;
      if (operation === 'getCapabilityDefinition') return definition;
      if (operation === 'callCapability')
        return {
          method,
          traceId: 'fixture-only-response',
          data: {},
          contractValid: true,
          contractIssues: []
        } as ResponseOf<K>;
      throw new Error(`Unexpected fixture operation: ${operation}`);
    }
  );
  return { method, request, gateway: { request } satisfies GatewayClient };
}

async function openFixture(wrapper: ReturnType<typeof mountView>) {
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain('alibaba.icbu.product.list');
  });
  const button = wrapper
    .findAll('button')
    .find((candidate) => candidate.text() === 'alibaba.icbu.product.list');
  if (!button) throw new Error('Missing fixture method button');
  await button.trigger('click');
  await vi.waitFor(() => {
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
  await flushPromises();
}
