import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type {
  ShippingQuoteRequest,
  ShippingProviderConfigurationSummary
} from '../../packages/core/src/shipping-services';
import { parseFreightosQuote } from '../../packages/core/src/shipping-quote-provider';
import requestFixture from '../../mock/data/shipping-services/cn-export-request.json' with { type: 'json' };
import providerFixture from '../../mock/data/shipping-services/freightos-estimate.json' with { type: 'json' };
import { formatDateTime } from '../../packages/ui/src/lib/date-time';

const quotedAtUtc = Date.UTC(2026, 10, 9, 4, 5, 6);

async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath(name), fullPage: true, animations: 'disabled' });
}

async function harness(page: Page) {
  const calls: string[] = [];
  const external: string[] = [];
  let summary: ShippingProviderConfigurationSummary = {
    provider: 'freightos',
    configured: false,
    revision: null,
    updatedAtUtc: null
  };
  let lastQuote: ShippingQuoteRequest | null = null;
  let empty = false;
  let failure = false;
  await page.route('https://**', (route) => {
    external.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  await page.exposeFunction('__shippingOffline', (action: string, value: unknown) => {
    calls.push(action);
    if (action === 'configuration') return summary;
    if (action === 'save') {
      const input = value as {
        provider: string;
        apiKey: string;
        termsAccepted: boolean;
        costAcknowledged: boolean;
        expectedRevision: number | null;
      };
      expect(input.provider).toBe('freightos');
      expect(input.termsAccepted && input.costAcknowledged).toBe(true);
      expect(input.expectedRevision).toBe(summary.revision);
      summary = {
        provider: 'freightos',
        configured: true,
        revision: (summary.revision ?? 0) + 1,
        updatedAtUtc: Date.now()
      };
      return summary;
    }
    if (action === 'clear') {
      expect(value).toEqual({ provider: 'freightos', expectedRevision: summary.revision });
      summary = { provider: 'freightos', configured: false, revision: null, updatedAtUtc: null };
      return null;
    }
    const input = value as ShippingQuoteRequest;
    lastQuote = input;
    expect(input.provider).toBe('freightos');
    expect(input.shipment.origin.countryCode).toBe('CN');
    expect(input.consent).toEqual({ dataSharing: true, costAcknowledged: true });
    if (failure) throw new Error('fixture-upstream-message-not-for-display');
    const result = { ...parseFreightosQuote(providerFixture, input), quotedAtUtc };
    return empty ? { ...result, options: [] } : result;
  });
  const install = async () => {
    await page.getByRole('button', { name: '物流服务', exact: true }).waitFor();
    await page.evaluate(() => {
      // Test-only service injection, following the existing offline E2E harness pattern.
      const object = (value: unknown): Record<PropertyKey, unknown> => {
        if (!value || typeof value !== 'object') throw new Error('Missing Vue test host');
        return value as Record<PropertyKey, unknown>;
      };
      const root = document.querySelector('#app');
      const app = object(root && Reflect.get(root, '__vue_app__'));
      const provides = object(object(app._instance).provides);
      const key = Reflect.ownKeys(provides).find(
        (item) => typeof item === 'symbol' && item.description === 'one-vegetable-services'
      );
      if (!key) throw new Error('App services unavailable');
      const services = object(provides[key]);
      const call = (
        globalThis as unknown as { __shippingOffline: (action: string, value: unknown) => Promise<unknown> }
      ).__shippingOffline;
      services.shippingServices = {
        configuration: (provider: string) => call('configuration', provider),
        saveConfiguration: (input: unknown) => call('save', input),
        clearConfiguration: (provider: string, expectedRevision: number) =>
          call('clear', { provider, expectedRevision }),
        quote: (input: unknown) => call('quote', input)
      };
    });
  };
  await page.goto('/#/logistics');
  await install();
  return {
    calls,
    external,
    install,
    lastQuote: () => lastQuote,
    empty: () => {
      empty = true;
    },
    fail: () => {
      failure = true;
    }
  };
}
async function configure(page: Page) {
  await page.getByTestId('shipping-configure').click();
  const dialog = page.getByRole('dialog', { name: '配置 Freightos / 开通指引', exact: true });
  await expect(dialog).toContainText('普通市场账号登录不等于 API 密钥');
  await page.getByTestId('shipping-api-key').fill('fixture-key-not-real');
  await expect(page.getByTestId('shipping-save')).toBeDisabled();
  await page.getByTestId('shipping-config-terms').check();
  await expect(page.getByTestId('shipping-save')).toBeDisabled();
  await page.getByTestId('shipping-config-cost').check();
  await page.getByTestId('shipping-save').click();
  await expect(page.getByTestId('shipping-api-key')).toHaveValue('');
  await dialog.getByRole('button', { name: '关闭详情', exact: true }).click();
}
async function fill(page: Page) {
  const shipment = requestFixture.shipment;
  await page.getByTestId('shipping-mode').selectOption('lcl');
  const values = {
    originProvince: shipment.origin.state,
    originCity: shipment.origin.city,
    originPostal: shipment.origin.postalCode,
    destinationCountry: shipment.destination.countryCode,
    destinationProvince: shipment.destination.state,
    destinationCity: shipment.destination.city,
    destinationPostal: shipment.destination.postalCode,
    quantity: String(shipment.quantity),
    weightKg: String(shipment.weightKg),
    lengthCm: String(shipment.lengthCm),
    widthCm: String(shipment.widthCm),
    heightCm: String(shipment.heightCm),
    declaredValue: String(shipment.declaredValue)
  };
  for (const [name, value] of Object.entries(values)) await page.getByTestId('shipping-' + name).fill(value);
}
async function send(page: Page) {
  await page.getByTestId('shipping-review').click();
  await expect(page.getByTestId('shipping-send')).toBeDisabled();
  await page.getByTestId('shipping-quote-data').check();
  await expect(page.getByTestId('shipping-send')).toBeDisabled();
  await page.getByTestId('shipping-quote-cost').check();
  await page.getByTestId('shipping-send').click();
}

test('offline Freightos flow requires single-request consent and renders real fixture currency in Chinese/light and English/dark/narrow', async ({
  page
}, testInfo) => {
  const fixture = await harness(page);
  await expect(page.getByRole('button', { name: '运费试算', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByRole('button', { name: '物流服务', exact: true }).click();
  const workspace = page.getByTestId('shipping-services-workspace');
  await expect(workspace).toContainText('本应用真实接入待验收');
  const directory = page.getByTestId('shipping-directory');
  await expect(directory.locator('input')).toHaveCount(2);
  await expect(directory.getByTestId('shipping-originCity')).toHaveCount(0);
  await expect(directory.getByTestId('shipping-destinationCountry')).toHaveCount(0);
  await expect(workspace.getByRole('textbox', { name: '始发国（只读）', exact: true })).toHaveValue(
    '中国大陆（CN）'
  );
  await expect(workspace.getByRole('textbox', { name: '始发国（只读）', exact: true })).toHaveAttribute(
    'readonly',
    ''
  );
  expect(fixture.calls).toEqual([]);
  await fill(page);
  await page.getByTestId('shipping-destinationCountry').fill('美国 (US)');
  await page.getByTestId('language-toggle').click();
  await expect(workspace).toContainText('live integration acceptance is pending');
  await page.getByTestId('language-toggle').click();
  expect(fixture.calls).toEqual([]);
  await configure(page);
  expect(fixture.calls).toEqual(['configuration', 'save']);
  await expect(page.getByTestId('shipping-acceptance-pending')).toBeVisible();
  await page.getByTestId('shipping-review').click();
  await expect(page.getByTestId('shipping-frozen-request')).toContainText('"countryCode": "CN"');
  await expect(page.getByTestId('shipping-frozen-request')).toContainText('"currency": "CNY"');
  await expect(page.getByRole('dialog')).toContainText('每日 10 次');
  await expect(page.getByTestId('shipping-send')).toBeDisabled();
  await page.getByTestId('shipping-quote-data').check();
  await expect(page.getByTestId('shipping-send')).toBeDisabled();
  expect(fixture.calls).toEqual(['configuration', 'save']);
  await page.getByTestId('shipping-quote-cost').check();
  await page.getByTestId('shipping-send').click();
  await expect(page.getByTestId('shipping-results')).toContainText('USD 394.43');
  await expect(page.getByTestId('shipping-results')).not.toContainText('CNY 394.43');
  await expect(page.getByTestId('shipping-quoted-at')).toContainText(formatDateTime(quotedAtUtc));
  await expect(page.getByTestId('shipping-acceptance-pending')).toHaveCount(0);
  expect(fixture.lastQuote()?.shipment.destination.countryCode).toBe('US');
  expect(fixture.lastQuote()?.shipment.currency).toBe('CNY');
  expect(fixture.calls.filter((action) => action === 'quote')).toHaveLength(1);
  await capture(page, testInfo, 'shipping-zh-light.png');
  await page.getByTestId('language-toggle').click();
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app-primary-navigation')).toHaveAttribute('aria-hidden', 'true');
  await expect
    .poll(async () => {
      const navigation = await page.locator('#app-primary-navigation').boundingBox();
      return navigation ? navigation.x + navigation.width : 0;
    })
    .toBeLessThanOrEqual(0);
  await expect(workspace).toContainText('Market estimate');
  await expect(page.getByTestId('shipping-quoted-at')).toHaveText(
    'Quoted at: ' + formatDateTime(quotedAtUtc)
  );
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await capture(page, testInfo, 'shipping-en-dark-narrow.png');
  await page.getByRole('button', { name: 'Shipping quote', exact: true }).click();
  await page.getByRole('button', { name: 'Shipping services', exact: true }).click();
  await expect(page.getByTestId('shipping-originCity')).toHaveValue('Shenzhen');
  expect(fixture.calls.filter((action) => action === 'quote')).toHaveLength(1);
  expect(fixture.external).toEqual([]);
  const local = await page.evaluate(() => JSON.stringify(localStorage));
  expect(local).not.toContain('Shenzhen');
  expect(local).not.toContain('fixture-key-not-real');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId('language-toggle').click();
  await page.reload();
  await fixture.install();
  await page.getByRole('button', { name: '物流服务', exact: true }).click();
  await expect(page.getByTestId('shipping-originCity')).toHaveValue('');
  await expect(page.getByTestId('shipping-review')).toBeDisabled();
  expect(fixture.calls.filter((action) => action === 'configuration')).toHaveLength(1);
});

test('express directory is local, supports Chinese keywords and never silently substitutes HK or opens third-party assets', async ({
  page
}) => {
  const fixture = await harness(page);
  await page.getByRole('button', { name: '物流服务', exact: true }).click();
  await page.getByTestId('shipping-mode').selectOption('express');
  await expect(page.getByTestId('shipping-directory-dhl')).toBeVisible();
  await expect(page.getByTestId('shipping-directory-maersk')).toHaveCount(0);
  await expect(page.getByTestId('shipping-review')).toHaveCount(0);
  await expect(page.getByTestId('shipping-services-workspace')).toContainText('不会发送 API 请求');
  await page.getByTestId('shipping-keyword').fill('顺丰');
  await expect(page.locator('[data-testid^="shipping-directory-"]')).toHaveCount(1);
  const links = await page
    .locator('[data-testid^="shipping-directory-"] a')
    .evaluateAll((elements) =>
      elements.map((element) => ({ href: element.getAttribute('href'), rel: element.getAttribute('rel') }))
    );
  expect(links.every((link) => link.rel?.includes('noreferrer'))).toBe(true);
  expect(links.every((link) => !link.href?.includes('Shenzhen'))).toBe(true);
  await expect(page.getByTestId('shipping-services-workspace').locator('img,iframe')).toHaveCount(0);
  expect(fixture.calls).toEqual([]);
  expect(fixture.external).toEqual([]);
});

test('clear confirmation has one dialog layer; empty/error results never fall back to example rates or retry', async ({
  page
}) => {
  const fixture = await harness(page);
  await page.getByRole('button', { name: '物流服务', exact: true }).click();
  await configure(page);
  await fill(page);
  fixture.empty();
  await send(page);
  await expect(page.getByTestId('shipping-results')).toContainText('未返回运价');
  await expect(page.getByTestId('shipping-results')).not.toContainText('394.43');
  fixture.fail();
  await send(page);
  await expect(page.getByTestId('shipping-results')).toHaveCount(0);
  await expect(page.getByRole('alert')).not.toContainText('fixture-upstream-message');
  expect(fixture.calls.filter((action) => action === 'quote')).toHaveLength(2);
  await page.getByTestId('shipping-configure').click();
  await page.getByTestId('shipping-clear').click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByTestId('shipping-api-key')).toHaveCount(0);
  await page
    .getByRole('dialog', { name: '清除 Freightos 配置？', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  expect(fixture.calls.filter((action) => action === 'clear')).toHaveLength(0);
  await page.getByTestId('shipping-configure').click();
  await page.getByTestId('shipping-clear').click();
  await page
    .getByRole('dialog', { name: '清除 Freightos 配置？', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('shipping-review')).toBeDisabled();
  expect(fixture.calls.filter((action) => action === 'clear')).toHaveLength(1);
  expect(fixture.external).toEqual([]);
});
