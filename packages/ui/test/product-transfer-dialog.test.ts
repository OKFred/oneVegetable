// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Product, ProductTransferDocumentV1, ProductTransferSchemaFormat } from '@one-vegetable/core';

import ProductTransferDialog from '../src/components/ProductTransferDialog.vue';
import type {
  ProductTransferFileFormat,
  ProductTransferImportSelection
} from '../src/lib/product-transfer-archive';

const product: Product = {
  id: '10000001',
  encryptedId: 'encrypted-10000001',
  subject: 'Portable solar power station 1000W',
  groupName: 'Solar generators',
  status: 'online',
  score: 92,
  imageUrl: null,
  updatedAt: '2026-08-29T00:00:00.000Z',
  categoryId: 100009999
};
let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
});

describe('ProductTransferDialog', () => {
  it('requires confirmation for cancel and close, while closing confirmation returns directly', async () => {
    const host = mountDialog('export');
    await nextTick();

    button(getDialog('导出商品'), '取消').click();
    await flushPromises();
    expect(getDialog('确认关闭')).toBeTruthy();

    closeButton('确认关闭').click();
    await flushPromises();
    expect(findDialog('确认关闭')).toBeUndefined();
    expect(getDialog('导出商品')).toBeTruthy();
    expect(host.open.value).toBe(true);

    closeButton('导出商品').click();
    await flushPromises();
    button(getDialog('确认关闭'), '确认关闭').click();
    await flushPromises();
    expect(host.open.value).toBe(false);
    expect(findDialog('导出商品')).toBeUndefined();
  });

  it('requires confirmation for overlay and Escape, but Escape on confirmation returns to the main dialog', async () => {
    const host = mountDialog('export');
    await nextTick();

    overlay().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    overlay().click();
    await flushPromises();
    expect(getDialog('确认关闭')).toBeTruthy();
    button(getDialog('确认关闭'), '返回').click();
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(getDialog('确认关闭')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(findDialog('确认关闭')).toBeUndefined();
    expect(getDialog('导出商品')).toBeTruthy();
    expect(host.open.value).toBe(true);
  });

  it('validates an import in memory and emits it only after execution confirmation', async () => {
    const host = mountDialog('import');
    await nextTick();
    const input = getDialog('导入商品').querySelector<HTMLInputElement>(
      'input[aria-label="选择商品 JSON 或 ZIP 文件"]'
    );
    if (!input) throw new Error('Missing import input');
    const file = new File([JSON.stringify(transferDocument())], 'products.json', {
      type: 'application/json'
    });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      expect(getDialog('导入商品').textContent).toContain('1 个商品');
    });
    expect(host.confirmImport).not.toHaveBeenCalled();
    button(getDialog('导入商品'), '导入').click();
    await flushPromises();
    expect(host.confirmImport).not.toHaveBeenCalled();
    button(getDialog('确认导入'), '确认导入').click();
    await flushPromises();
    expect(host.confirmImport).toHaveBeenCalledOnce();
    const selection = host.confirmImport.mock.calls[0]?.[0];
    expect(selection?.kind).toBe('json');
    if (selection?.kind !== 'json') throw new Error('Expected JSON import selection');
    expect(selection.document.schemaVersion).toBe(1);
  });

  it('keeps execution and closing disabled while an operation is in progress', async () => {
    const host = mountDialog('export', true);
    await nextTick();
    const dialog = getDialog('导出商品');

    expect(button(dialog, '取消').disabled).toBe(true);
    expect(button(dialog, '处理中…').disabled).toBe(true);
    closeButton('导出商品').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(findDialog('确认关闭')).toBeUndefined();
    expect(host.open.value).toBe(true);
  });

  it('keeps the advanced settings summary independent from individual option values', async () => {
    const host = mountDialog('export');
    await nextTick();
    const dialog = getDialog('导出商品');
    const summary = dialog.querySelector('summary');
    const xmlOption = dialog.querySelector<HTMLInputElement>('input[aria-label="Schema XML"]');
    const zipOption = dialog.querySelector<HTMLInputElement>('input[aria-label="ZIP 资源包"]');
    if (!summary || !xmlOption || !zipOption) throw new Error('Missing advanced export settings');

    expect(summary.textContent.trim()).toBe('高级设置');
    xmlOption.click();
    await nextTick();
    expect(host.schemaFormat.value).toBe('xml');
    zipOption.click();
    await nextTick();
    expect(host.fileFormat.value).toBe('zip');
    expect(summary.textContent.trim()).toBe('高级设置');
  });
});

function mountDialog(mode: 'import' | 'export', busy = false) {
  const open = ref(true);
  const schemaFormat = ref<ProductTransferSchemaFormat>('json');
  const fileFormat = ref<ProductTransferFileFormat>('json');
  const confirmImport = vi.fn<(selection: ProductTransferImportSelection) => void>();
  const confirmExport = vi.fn<() => void>();
  const Host = defineComponent({
    setup() {
      return () =>
        h(ProductTransferDialog, {
          open: open.value,
          mode,
          busy,
          error: '',
          schemaFormat: schemaFormat.value,
          fileFormat: fileFormat.value,
          exportProducts: mode === 'export' ? [product] : [],
          'onUpdate:open': (value: boolean) => {
            open.value = value;
          },
          'onUpdate:schemaFormat': (value: ProductTransferSchemaFormat) => {
            schemaFormat.value = value;
          },
          'onUpdate:fileFormat': (value: ProductTransferFileFormat) => {
            fileFormat.value = value;
          },
          onConfirmImport: confirmImport,
          onConfirmExport: confirmExport
        });
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  cleanup = () => {
    wrapper.unmount();
  };
  return { wrapper, open, schemaFormat, fileFormat, confirmImport, confirmExport };
}

function transferDocument(): ProductTransferDocumentV1 {
  return {
    format: 'one-vegetable-products',
    schemaVersion: 1,
    exportedAtUtc: '2026-08-29T00:00:00.000Z',
    products: [
      {
        source: {
          productId: product.id,
          subject: product.subject,
          groupName: product.groupName,
          status: product.status,
          updatedAt: product.updatedAt
        },
        categoryId: 100009999,
        language: 'en_US',
        market: 'wholesale',
        schemaXml:
          '<schema><field id="subject" name="Product title" type="input" required="true"><value>Portable solar power station 1000W</value></field></schema>',
        schemaJson: {
          format: 'one-vegetable-product-schema',
          schemaVersion: 1,
          root: {
            type: 'element',
            name: 'schema',
            attributes: {},
            children: [
              {
                type: 'element',
                name: 'field',
                attributes: {
                  id: 'subject',
                  name: 'Product title',
                  type: 'input',
                  required: 'true'
                },
                children: [
                  {
                    type: 'element',
                    name: 'value',
                    attributes: {},
                    children: [{ type: 'text', value: product.subject }]
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  };
}

function findDialog(title: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) =>
    dialog.textContent.includes(title)
  );
}

function getDialog(title: string): HTMLElement {
  const dialog = findDialog(title);
  if (!dialog) throw new Error(`Missing dialog: ${title}`);
  return dialog;
}

function button(root: Element, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function closeButton(title: string): HTMLButtonElement {
  const match = document.body.querySelector<HTMLButtonElement>(`button[aria-label="关闭${title}"]`);
  if (!match) throw new Error(`Missing close button: ${title}`);
  return match;
}

function overlay(): HTMLElement {
  const match = document.body.querySelector<HTMLElement>('.ov-dialog-overlay');
  if (!match) throw new Error('Missing dialog overlay');
  return match;
}
