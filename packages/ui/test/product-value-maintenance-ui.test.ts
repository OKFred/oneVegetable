// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import api from '../../../mock/data/product-maintenance-api.json';
import persisted from '../../../mock/data/product-maintenance-repository.json';
import jobs from '../../../mock/data/product-value-maintenance.json';
import readData from '../../../mock/data/product-read-tools.json';
import {
  ProductMaintenanceService,
  type ProductMaintenanceCommand,
  type ProductMaintenanceRecord,
  type ProductMaintenanceTask
} from '@one-vegetable/core/product-maintenance-service';
import {
  PRODUCT_MAINTENANCE_METHODS,
  type ProductMaintenanceDraft,
  type ProductMaintenanceSnapshot,
  type KnownProductDraft
} from '@one-vegetable/core/product-maintenance-api';
import { GatewayException } from '@one-vegetable/core/errors';
import type { SettingsRepository, ProductMutationJobPage } from '@one-vegetable/core';
import ProductValueMaintenanceDialog from '../src/components/ProductValueMaintenanceDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';
import { uiI18n } from '../src/i18n';
import { productValueMaintenance as en } from '../src/i18n/messages/en-US/productValueMaintenance';
import { productValueMaintenance as zh } from '../src/i18n/messages/zh-CN/productValueMaintenance';

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  vi.restoreAllMocks();
});
function setup(kind: 'price' | 'inventory' | 'drafts' = 'inventory', available = true) {
  const scope = ref('fixture-scope'),
    visible = ref(true);
  const props = reactive({ kind, productId: api.drafts.inventory.productId });
  const records = new Map<string, ProductMaintenanceRecord>();
  let currentDraft: ProductMaintenanceDraft = api.drafts.inventory as ProductMaintenanceDraft;
  let ids = 0,
    dropSend = false,
    mismatch = false;
  const providerCall = vi.fn((method: string) =>
    Promise.resolve({
      method,
      data: structuredClone(
        method === PRODUCT_MAINTENANCE_METHODS.deleteDraft ? api.responses.deleteOne : api.responses.accepted
      )
    })
  );
  function snapshot(phase: string): ProductMaintenanceSnapshot {
    const base = structuredClone(api.snapshots.matching) as ProductMaintenanceSnapshot;
    if (phase !== 'verify' || mismatch) return base;
    const value = currentDraft;
    if (value.operation === 'deleteDraft') return base;
    if (value.mode === 'sku') {
      for (const row of value.skus) {
        const item = base.skus.find((sku) => sku.id === row.skuId);
        if (!item) continue;
        if ('price' in row && value.operation === 'setPrice') {
          item.price = row.price;
          item.currency = value.currency;
        }
        if ('inventory' in row) item.inventory = row.inventory;
      }
    } else if (value.operation === 'setInventory') base.inventory = value.inventory;
    else if (value.mode === 'range')
      base.price = {
        type: 'RANGE',
        currency: 'USD',
        min: value.minPrice,
        max: value.maxPrice,
        tiers: []
      };
    else
      base.price = {
        type: 'TIERED',
        currency: 'USD',
        min: null,
        max: null,
        tiers: value.tiers.map((row) => ({ quantity: row.quantity, price: row.price }))
      };
    return base;
  }
  const service = new ProductMaintenanceService(
    {
      get: (id) => Promise.resolve(records.get(id) ?? null),
      list: () => Promise.resolve([...records.values()]),
      save: (record, revision) => {
        const previous = records.get(record.task.id);
        if ((previous?.task.revision ?? null) !== revision)
          return Promise.reject(new Error('ENTITY_VERSION_CONFLICT'));
        records.set(record.task.id, structuredClone(record));
        return Promise.resolve();
      }
    },
    (context, _requestId, _intent, phase) =>
      Promise.resolve({
        context,
        protocol: 'iop',
        enabled: true,
        client: { call: providerCall },
        readProduct: () => Promise.resolve(snapshot(phase)),
        knownDrafts: api.service.knownDrafts as KnownProductDraft[],
        readDrafts: (draftIds) =>
          Promise.resolve(
            api.service.draftReads.absent.filter((row) => draftIds.includes(row.draftId)) as {
              draftId: string;
              status: 'absent';
            }[]
          )
      }),
    () => api.service.now,
    () => api.service.taskIds[ids++] ?? api.persistedIntentId
  );
  const control = vi.fn(
    async (
      command: ProductMaintenanceCommand,
      context: { identity: string; gateway: string },
      requestId?: string
    ) => {
      if (command.action === 'create') currentDraft = command.draft as ProductMaintenanceDraft;
      const value = await service.execute(api.service.ownerId, { requestId, context, command });
      if (command.action === 'send' && dropSend) throw new Error('REQUEST_TIMEOUT');
      return value;
    }
  );
  const contextRead = vi.fn(() => Promise.resolve({ ...api.service.context, storage: null }));
  const listJobs = vi.fn(() => Promise.resolve(structuredClone(jobs) as ProductMutationJobPage));
  const onClose = vi.fn(() => {
    visible.value = false;
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({
          gateway: { request: vi.fn(), galleryTransferContext: contextRead },
          settings: {} as SettingsRepository,
          mode: 'bff',
          ...(available ? { productMaintenance: { productMaintenance: control } } : {}),
          productMutationJobs: { list: listJobs, get: vi.fn(), refresh: vi.fn(), recover: vi.fn() }
        });
        provideListIdentityScope(computed(() => scope.value));
        return () => (visible.value ? h(ProductValueMaintenanceDialog, { ...props, onClose }) : null);
      }
    }),
    {
      global: {
        stubs: {
          ModalDialog: {
            props: ['open', 'title'],
            template: '<section v-if="open"><h2>{{ title }}</h2><slot/><slot name="footer"/></section>'
          },
          ConfirmActionDialog: {
            props: ['open', 'pending', 'confirmLabel'],
            emits: ['confirm', 'update:open'],
            template:
              '<section v-if="open" data-confirm><slot/><button data-action="confirm-send" :disabled="pending" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><button data-action="cancel-confirm" @click="$emit(\'update:open\', false)">Cancel</button></section>'
          }
        }
      }
    }
  );
  wrappers.push(wrapper);
  return {
    wrapper,
    control,
    contextRead,
    providerCall,
    listJobs,
    scope,
    props,
    records,
    onClose,
    reopen: async () => {
      visible.value = true;
      await nextTick();
    },
    dropSend: () => {
      dropSend = true;
    },
    mismatch: () => {
      mismatch = true;
    }
  };
}
async function settle() {
  await flushPromises();
  await vi.waitFor(() => {
    expect(wrappers.some((wrapper) => wrapper.find('[aria-busy="true"]').exists())).toBe(false);
  });
}
async function set(wrapper: VueWrapper, field: string, value: string) {
  await wrapper.get('[data-field="' + field + '"]').setValue(value);
}
async function prepareInventory(wrapper: VueWrapper) {
  await set(wrapper, 'inventory', api.drafts.inventory.inventory);
  await wrapper.get('form').trigger('submit');
  await settle();
}
async function confirm(wrapper: VueWrapper) {
  await wrapper.get('[data-action="review"]').trigger('click');
  expect(wrapper.find('[data-confirm]').exists()).toBe(true);
  await wrapper.get('[data-action="confirm-send"]').trigger('click');
  await settle();
}
describe('product value maintenance UI', () => {
  it('keeps both locale catalogs aligned and nonempty', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const value of [...Object.values(en), ...Object.values(zh)]) expect(value.trim()).not.toBe('');
  });
  it.each(['price', 'inventory', 'drafts'] as const)(
    'does not automatically call APIs on opening %s',
    async (kind) => {
      const { wrapper, control, contextRead, listJobs } = setup(kind);
      await settle();
      expect(control).not.toHaveBeenCalled();
      expect(contextRead).not.toHaveBeenCalled();
      expect(listJobs).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain(en.closeHint);
      expect(wrapper.find('[data-action="load-tasks"]').exists()).toBe(true);
    }
  );
  it('creates a persisted inventory baseline and requires a second confirmation before one send', async () => {
    const { wrapper, control, providerCall, contextRead } = setup();
    await prepareInventory(wrapper);
    expect(control.mock.calls[0]?.[0]).toEqual({ action: 'create', draft: api.drafts.inventory });
    expect(providerCall).not.toHaveBeenCalled();
    expect(wrapper.find('[data-result="preview"]').exists()).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(contextRead).toHaveBeenCalledWith('callCapability', {
      method: PRODUCT_MAINTENANCE_METHODS.setInventory,
      parameters: {}
    });
    await wrapper.get('[data-action="review"]').trigger('click');
    expect(providerCall).not.toHaveBeenCalled();
    await wrapper.get('[data-action="cancel-confirm"]').trigger('click');
    expect(providerCall).not.toHaveBeenCalled();
    await confirm(wrapper);
    expect(control.mock.calls.map(([command]) => command.action)).toEqual(['create', 'send']);
    expect(providerCall).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-action="review"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain(en.accepted);
    await wrapper.get('[data-action="verify"]').trigger('click');
    await settle();
    expect(control.mock.calls.map(([command]) => command.action)).toEqual([
      'create',
      'send',
      'get',
      'verify'
    ]);
    expect(wrapper.text()).toContain(en.verified);
    expect(providerCall).toHaveBeenCalledTimes(1);
  });
  it('retains exact integer monetary values in row controls', async () => {
    const { wrapper, control } = setup('price');
    const value = api.drafts.tiered.tiers[0]?.quantity ?? '';
    await set(wrapper, 'tier-quantity-0', value);
    await set(wrapper, 'tier-price-0', value);
    await wrapper.get('form').trigger('submit');
    await settle();
    expect(control.mock.calls[0]?.[0]).toEqual({
      action: 'create',
      draft: {
        operation: 'setPrice',
        productId: api.drafts.tiered.productId,
        mode: 'tiered',
        currency: 'USD',
        tiers: [{ quantity: value, price: value }]
      }
    });
    expect(wrapper.find('[data-result="preview"]').exists()).toBe(true);
  });
  it('preserves high-precision USD range values without Number conversion', async () => {
    const { wrapper, control } = setup('price');
    await set(wrapper, 'priceMode', 'range');
    await set(wrapper, 'minPrice', api.drafts.range.minPrice);
    await set(wrapper, 'maxPrice', api.drafts.range.maxPrice);
    await wrapper.get('form').trigger('submit');
    await settle();
    expect(control.mock.calls[0]?.[0]).toEqual({ action: 'create', draft: api.drafts.range });
    expect(wrapper.get('[data-result="preview"]').text()).toContain(api.drafts.range.maxPrice);
  });
  it('requires explicit SKU currency and preserves SKU price strings', async () => {
    const { wrapper, control } = setup('price');
    await set(wrapper, 'priceMode', 'sku');
    const row = api.drafts.skuPrice.skus[0];
    await set(wrapper, 'price-sku-0', row?.skuId ?? '');
    await set(wrapper, 'sku-price-0', row?.price ?? '');
    await wrapper.get('form').trigger('submit');
    expect(control).not.toHaveBeenCalled();
    await set(wrapper, 'currency', api.drafts.skuPrice.currency);
    await wrapper.get('form').trigger('submit');
    await settle();
    expect(control.mock.calls[0]?.[0]).toEqual({ action: 'create', draft: api.drafts.skuPrice });
  });
  it('supports exact absolute SPU and SKU inventories including zero and signed-64-bit maximum', async () => {
    const { wrapper, control } = setup();
    await set(wrapper, 'inventoryMode', 'sku');
    for (const [index, row] of api.drafts.skuInventory.skus.entries()) {
      if (index) await wrapper.get('[data-action="add-inventory-sku"]').trigger('click');
      await set(wrapper, 'inventory-sku-' + String(index), row.skuId);
      await set(wrapper, 'sku-inventory-' + String(index), row.inventory);
    }
    await wrapper.get('form').trigger('submit');
    await settle();
    expect(control.mock.calls[0]?.[0]).toEqual({ action: 'create', draft: api.drafts.skuInventory });
  });
  it('does not offer resend after a lost send response and only reads/verifies the durable task', async () => {
    const state = setup();
    await prepareInventory(state.wrapper);
    state.dropSend();
    await confirm(state.wrapper);
    expect(state.wrapper.get('[data-action="review"]').attributes('disabled')).toBeDefined();
    expect(state.wrapper.text()).toContain(en.attemptedHint);
    await state.wrapper.get('[data-action="verify"]').trigger('click');
    await settle();
    expect(state.control.mock.calls.filter(([command]) => command.action === 'send')).toHaveLength(1);
    expect(state.providerCall).toHaveBeenCalledTimes(1);
    expect(state.wrapper.text()).toContain(en.verified);
  });
  it('cancels an unsent preview explicitly without provider writes', async () => {
    const { wrapper, control, providerCall } = setup();
    await prepareInventory(wrapper);
    await wrapper.get('[data-action="cancel-preview"]').trigger('click');
    await settle();
    expect(control.mock.calls.map(([command]) => command.action)).toEqual(['create', 'cancel']);
    expect(wrapper.find('[data-result="preview"]').exists()).toBe(false);
    expect(providerCall).not.toHaveBeenCalled();
  });
  it('restores prepared tasks after closing, without auto send, and permits explicit cancellation', async () => {
    const state = setup();
    await prepareInventory(state.wrapper);
    await state.wrapper.get('[data-action="close"]').trigger('click');
    await state.reopen();
    expect(state.control).toHaveBeenCalledTimes(1);
    await state.wrapper.get('[data-action="load-tasks"]').trigger('click');
    await settle();
    await state.wrapper.get('[data-action="select-task"]').trigger('click');
    expect(state.wrapper.text()).toContain(en.resumedHint);
    expect(state.wrapper.get('[data-action="review"]').attributes('disabled')).toBeDefined();
    await state.wrapper.get('[data-action="cancel-preview"]').trigger('click');
    await settle();
    expect(state.control.mock.calls.map(([command]) => command.action)).toEqual(['create', 'list', 'cancel']);
    expect(state.providerCall).not.toHaveBeenCalled();
  });
  it('restores an attempted task after closing and verifies read-only without a second send', async () => {
    const state = setup();
    await prepareInventory(state.wrapper);
    state.dropSend();
    await confirm(state.wrapper);
    await state.wrapper.get('[data-action="close"]').trigger('click');
    await state.reopen();
    await state.wrapper.get('[data-action="load-tasks"]').trigger('click');
    await settle();
    await state.wrapper.get('[data-action="select-task"]').trigger('click');
    await state.wrapper.get('[data-action="verify"]').trigger('click');
    await settle();
    expect(state.control.mock.calls.filter(([command]) => command.action === 'send')).toHaveLength(1);
    expect(state.wrapper.text()).toContain(en.verified);
  });
  it('filters maintenance tasks by current context, product and kind', async () => {
    const { wrapper, control } = setup();
    const good = structuredClone(persisted.records.inventory.task) as ProductMaintenanceTask;
    const wrong = { ...good, id: api.service.taskIds[1] ?? '', context: api.service.otherContext };
    control.mockResolvedValueOnce({
      tasks: [good, wrong, persisted.records.price.task as ProductMaintenanceTask]
    });
    await wrapper.get('[data-action="load-tasks"]').trigger('click');
    await settle();
    expect(wrapper.findAll('[data-action="select-task"]')).toHaveLength(1);
  });
  it('only lists current-context verified IOP saveProductDraft receipts and prepares single deletion', async () => {
    const { wrapper, listJobs, control, providerCall, contextRead } = setup('drafts');
    await wrapper.get('[data-action="load-drafts"]').trigger('click');
    await settle();
    expect(listJobs).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 50, status: 'verified' });
    expect(wrapper.findAll('[data-action="prepare-delete"]')).toHaveLength(1);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).not.toContain(jobs.items[4]?.productId ?? 'NO_MATCH');
    await wrapper.get('[data-action="prepare-delete"]').trigger('click');
    await settle();
    expect(control.mock.calls[0]?.[0]).toMatchObject({ action: 'create', draft: api.drafts.deleteOne });
    expect(providerCall).not.toHaveBeenCalled();
    expect(contextRead).toHaveBeenCalledWith('callCapability', {
      method: PRODUCT_MAINTENANCE_METHODS.deleteDraft,
      parameters: {}
    });
    await confirm(wrapper);
    expect(providerCall).toHaveBeenCalledTimes(1);
    expect(control.mock.calls.filter(([command]) => command.action === 'send')).toHaveLength(1);
  });
  it('clears preview, receipts and confirmation on identity/configuration changes', async () => {
    const state = setup();
    await prepareInventory(state.wrapper);
    await state.wrapper.get('[data-action="review"]').trigger('click');
    state.scope.value = 'new-fixture-scope';
    await nextTick();
    expect(state.wrapper.find('[data-result="preview"]').exists()).toBe(false);
    expect(state.wrapper.find('[data-confirm]').exists()).toBe(false);
    expect(state.control).toHaveBeenCalledTimes(1);
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await nextTick();
    expect(state.control).toHaveBeenCalledTimes(1);
  });
  it('makes permission rejection explicit without exposing provider text', async () => {
    const { wrapper, control } = setup();
    control.mockRejectedValueOnce(new GatewayException(readData.applicationPermissionDenial));
    await prepareInventory(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain(en.permissionDenied);
    expect(wrapper.get('[role="alert"]').text()).toContain(readData.applicationPermissionDenial.subCode);
  });
  it('restores a durably ambiguous task after closing and never resends it', async () => {
    const state = setup();
    await prepareInventory(state.wrapper);
    state.providerCall.mockRejectedValueOnce(new Error('REQUEST_TIMEOUT'));
    await confirm(state.wrapper);
    expect(state.wrapper.text()).toContain(en.ambiguous);
    await state.wrapper.get('[data-action="close"]').trigger('click');
    await state.reopen();
    await state.wrapper.get('[data-action="load-tasks"]').trigger('click');
    await settle();
    await state.wrapper.get('[data-action="select-task"]').trigger('click');
    expect(state.wrapper.get('[data-action="review"]').attributes('disabled')).toBeDefined();
    await state.wrapper.get('[data-action="verify"]').trigger('click');
    await settle();
    expect(state.control.mock.calls.filter(([command]) => command.action === 'send')).toHaveLength(1);
    expect(state.providerCall).toHaveBeenCalledTimes(1);
    expect(state.wrapper.text()).toContain(en.verified);
  });
  it('drops late preparation results after an identity change without redispatch', async () => {
    const state = setup();
    let finish!: (value: { tasks: ProductMaintenanceTask[] }) => void;
    state.control.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await set(state.wrapper, 'inventory', api.drafts.inventory.inventory);
    await state.wrapper.get('form').trigger('submit');
    await vi.waitFor(() => {
      expect(state.control).toHaveBeenCalledTimes(1);
    });
    state.scope.value = 'next-fixture-scope';
    await nextTick();
    finish({ tasks: [persisted.records.inventory.task as ProductMaintenanceTask] });
    await settle();
    expect(state.wrapper.find('[data-result="preview"]').exists()).toBe(false);
    expect(state.providerCall).not.toHaveBeenCalled();
    expect(state.control).toHaveBeenCalledTimes(1);
  });
  it('clears verified draft candidates on configuration changes without reloading them', async () => {
    const state = setup('drafts');
    await state.wrapper.get('[data-action="load-drafts"]').trigger('click');
    await settle();
    expect(state.wrapper.findAll('[data-action="prepare-delete"]')).toHaveLength(1);
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await nextTick();
    expect(state.wrapper.find('[data-action="prepare-delete"]').exists()).toBe(false);
    expect(state.listJobs).toHaveBeenCalledTimes(1);
    expect(state.control).not.toHaveBeenCalled();
  });

  it.each([
    ['METHOD_DISABLED', 'methodDisabledHint'],
    ['BASELINE_CHANGED', 'baselineChangedHint'],
    ['ENTITY_BUSY', 'entityBusyHint'],
    ['ALREADY_ATTEMPTED', 'alreadyAttemptedHint'],
    ['DRAFT_VERIFICATION_UNAVAILABLE', 'draftVerificationUnavailableHint']
  ] as const)(
    'explains %s in both locales and keeps its raw code in collapsed details',
    async (suffix, hint) => {
      for (const locale of ['en-US', 'zh-CN'] as const) {
        const labels = locale === 'en-US' ? en : zh;
        uiI18n.global.locale.value = locale;
        const { wrapper, control, providerCall } = setup();
        const code = 'PRODUCT_MAINTENANCE_' + suffix;
        control.mockRejectedValueOnce(new GatewayException({ code, message: code, retryable: false }));
        await prepareInventory(wrapper);
        const alert = wrapper.get('[role="alert"]');
        expect(alert.get('[data-maintenance-hint]').text()).toBe(labels[hint]);
        expect(alert.get('details summary').text()).toBe(labels.technicalDetails);
        expect(alert.get('details').attributes('open')).toBeUndefined();
        expect(alert.get('details code').text()).toBe(code);
        expect(providerCall).not.toHaveBeenCalled();
      }
    }
  );

  it('does not call an absent service and changes labels without provider calls', async () => {
    const { wrapper, control } = setup('inventory', false);
    expect(wrapper.text()).toContain(en.unavailable);
    expect(wrapper.get('[data-action="prepare"]').attributes('disabled')).toBeDefined();
    uiI18n.global.locale.value = 'zh-CN';
    await nextTick();
    expect(wrapper.text()).toContain(zh.inventoryTitle);
    expect(control).not.toHaveBeenCalled();
  });
});
