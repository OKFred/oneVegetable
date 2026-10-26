// @vitest-environment jsdom
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { AlibabaClient, NetworkManager } from '@one-vegetable/core';
import type {
  GatewayCredentials,
  NetworkTransport,
  OperationId,
  RequestOf,
  ResponseOf
} from '@one-vegetable/core';
import type { GalleryRequestOptions } from '../../core/src/gallery-transfer-context';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { IOP_BUSINESS_ENDPOINT } from '../../core/src/alibaba-iop';
import { ALIBABA_GATEWAY } from '../../core/src/signing';
import { executeCapabilityCall } from '../../core/src/capability-call';
import { selectAlibabaOperationProtocol } from '../../core/src/alibaba-protocol-routing';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../../core/src/capability-validation-worker';
import iop from '../../../mock/data/product-posting-type-iop.json';
import top from '../../../mock/data/product-type-available.json';
import credentials from '../../../mock/data/node-gateway-credentials.json';
import ProductPostingTypePicker from '../src/components/ProductPostingTypePicker.vue';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  uiI18n.global.locale.value = 'zh-CN';
});
const modes = [
  { name: 'TOP only', top: true, iop: false, defaultProtocol: 'top', legacy: false },
  { name: 'legacy TOP', top: true, iop: false, defaultProtocol: 'top', legacy: true },
  { name: 'IOP only', top: false, iop: true, defaultProtocol: 'iop', legacy: false },
  { name: 'dual / TOP default', top: true, iop: true, defaultProtocol: 'top', legacy: false },
  { name: 'dual / IOP default', top: true, iop: true, defaultProtocol: 'iop', legacy: false }
] as const;

describe('posting picker through protocol selection, signing and contract validation', () => {
  it.each(modes)(
    '$name resolves a real wire response without an authorization or shape error',
    async (mode) => {
      vi.stubGlobal('crypto', webcrypto);
      const available = { ...mode, bindingConfirmed: true };
      const payload = { method: iop.method, parameters: iop.request };
      const selected = selectAlibabaOperationProtocol('callCapability', payload, available);
      const context = { identity: 'posting-account', gateway: 'posting-' + selected, storage: null };
      const gateway = new MockGatewayClient(0);
      const readContext = vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue(context);
      const response = structuredClone(selected === 'iop' ? iop.response : top.response);
      if ('result' in response) response.result.data.supportPostWholeSale = false;
      else response.data.support_post_whole_sale = false;
      const send = vi
        .fn<NetworkTransport['send']>()
        .mockResolvedValue(
          Response.json(
            selected === 'iop' ? response : { alibaba_icbu_product_type_available_get_response: response }
          )
        );
      const settings: GatewayCredentials = {
        ...credentials.manual,
        ...(mode.legacy ? {} : { protocol: selected }),
        endpoint: selected === 'iop' ? IOP_BUSINESS_ENDPOINT : ALIBABA_GATEWAY,
        signMethod: selected === 'iop' ? 'hmac-sha256' : 'hmac'
      };
      const client = new AlibabaClient(
        settings,
        new NetworkManager({
          transport: { send },
          policies: { alibaba: { allowedOrigins: [new URL(settings.endpoint).origin] } }
        }),
        { maxAttempts: 1 }
      );
      const request = vi
        .spyOn(gateway, 'request')
        .mockImplementation(
          async <K extends OperationId>(
            operation: K,
            input: RequestOf<K>,
            options?: GalleryRequestOptions
          ): Promise<ResponseOf<K>> => {
            expect(selectAlibabaOperationProtocol(operation, input, available)).toBe(selected);
            expect(options).toEqual({ galleryContext: context });
            return (await executeCapabilityCall(client, input as Record<string, unknown>, {
              validateCapabilityRequest,
              validateCapabilityResponse
            })) as ResponseOf<K>;
          }
        );
      const market = ref<'wholesale' | 'sourcing'>('wholesale');
      const wrapper = mount(
        defineComponent({
          setup() {
            provideServices({
              gateway,
              mode: 'extension',
              settings: {
                load: () => Promise.resolve(settings),
                save: () => Promise.resolve()
              }
            });
            return () =>
              h(ProductPostingTypePicker, {
                modelValue: market.value,
                'onUpdate:modelValue': (value: 'wholesale' | 'sourcing') => {
                  market.value = value;
                },
                locked: false,
                categoryId: iop.request.type_request.cat_id,
                language: 'en_US'
              });
          }
        })
      );
      try {
        await flushPromises();
        await vi.waitFor(() => {
          expect(market.value).toBe('sourcing');
        });
        expect(wrapper.text()).not.toContain('尚未取得');
        expect(wrapper.get('input[value="wholesale"]').attributes('disabled')).toBeDefined();
        expect(wrapper.get('input[value="sourcing"]').attributes('disabled')).toBeUndefined();
        expect(readContext).toHaveBeenCalledWith('callCapability', payload);
        expect(request).toHaveBeenCalledExactlyOnceWith('callCapability', payload, {
          galleryContext: context
        });
        expect(send).toHaveBeenCalledOnce();
        const body = send.mock.calls[0]?.[1].body as URLSearchParams;
        if (selected === 'iop') {
          expect(body.get('cat_id')).toBe(String(iop.request.type_request.cat_id));
          expect(body.has('type_request')).toBe(false);
        } else expect(JSON.parse(body.get('type_request') ?? '')).toEqual(iop.request.type_request);
        uiI18n.global.locale.value = 'en-US';
        await flushPromises();
        expect(send).toHaveBeenCalledOnce();
      } finally {
        wrapper.unmount();
      }
    }
  );
});
