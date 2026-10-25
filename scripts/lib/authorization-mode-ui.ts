import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from '@playwright/test';
import { GatewayException } from '../../packages/core/src/errors';
import {
  classify,
  expectation,
  isRow,
  type AuthorizationMode,
  type Observation
} from './authorization-mode-regression';
import { ReadWireGuard } from './authorization-mode-wire';
import type { OperationId } from '../../packages/core/src/types';

/** Watches actual options-page RPCs; refuses any operation outside the independent read allowlist. */
export async function exerciseModeMenus(
  page: Page,
  mode: AuthorizationMode,
  guards: Map<string, ReadWireGuard>,
  results: Observation[]
) {
  const pending = new Map<string, { guard: ReadWireGuard; record: Observation; supported: boolean }>();
  const errors: string[] = [];
  const pages: { route: string; heading: boolean; completed: boolean }[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.exposeBinding('__modeBeforeRead', (_source, input: unknown) => {
    if (!isRow(input) || typeof input.requestId !== 'string' || typeof input.operation !== 'string')
      throw new Error('UI_READ_MESSAGE_INVALID');
    const operation = input.operation as OperationId;
    const expected = expectation(mode, operation, input.payload);
    const guard = new ReadWireGuard();
    guard.arm(input.requestId, expected.rules, expected.protocol);
    const record: Observation = {
      id: 'ui-' + operation,
      operation,
      expectedProtocol: expected.protocol,
      requestId: input.requestId,
      status: 'failed',
      requests: 0
    };
    pending.set(input.requestId, { guard, record, supported: expected.supported });
    if (input.kind === 'gateway-request') guards.set(input.requestId, guard);
  });
  await page.exposeBinding('__modeAfterRead', (_source, input: unknown) => {
    if (!isRow(input) || typeof input.requestId !== 'string') throw new Error('UI_READ_RESULT_INVALID');
    const current = pending.get(input.requestId);
    if (!current) throw new Error('UI_READ_CORRELATION_INVALID');
    const snapshot = current.guard.snapshot();
    const record = current.record;
    record.requests = snapshot.events.length;
    if (input.ok === true) record.status = 'passed';
    else if (isRow(input.error) && typeof input.error.code === 'string')
      Object.assign(
        record,
        classify(
          new GatewayException({
            code: input.error.code,
            message: typeof input.error.message === 'string' ? input.error.message : input.error.code,
            retryable: false,
            ...(typeof input.error.subCode === 'string' ? { subCode: input.error.subCode } : {})
          }),
          current.supported
        )
      );
    if (snapshot.blocked) {
      record.status = 'failed';
      record.code = 'READ_GUARD_DENIED';
    }
    current.guard.disarm();
    guards.delete(input.requestId);
    pending.delete(input.requestId);
    results.push(record);
  });
  await page.addInitScript(() => {
    type Message = Record<string, unknown>;
    const root = globalThis as unknown as {
      chrome?: { runtime: { sendMessage(message: Message): Promise<unknown> } };
      __modeBeforeRead(message: Message): Promise<void>;
      __modeAfterRead(message: Message): Promise<void>;
    };
    const runtime = root.chrome?.runtime;
    if (!runtime) return;
    const original = runtime.sendMessage.bind(runtime);
    runtime.sendMessage = async (message) => {
      if (message.kind !== 'gateway-request') return original(message);
      // No secret-bearing vault payload is forwarded to the observer.
      await root.__modeBeforeRead({
        kind: message.kind,
        operation: message.operation,
        payload: message.payload,
        requestId: message.requestId
      });
      try {
        const result = await original(message);
        const value = result as { ok?: unknown; error?: unknown };
        await root.__modeAfterRead({ requestId: message.requestId, ok: value.ok, error: value.error });
        return result;
      } catch {
        await root.__modeAfterRead({
          requestId: message.requestId,
          ok: false,
          error: { code: 'RUNTIME_READ_FAILED', message: 'RUNTIME_READ_FAILED' }
        });
        throw new Error('RUNTIME_READ_FAILED');
      }
    };
  });
  const base = page.url().split('#')[0];
  if (!base) throw new Error('UI_WORKBENCH_URL_REQUIRED');
  for (const route of [
    'dashboard',
    'products',
    'photos',
    'photos/videos',
    'inventory',
    'orders',
    'rfqs',
    'logistics',
    'insights',
    'capabilities',
    'templates',
    'logs',
    'releases',
    'settings'
  ]) {
    // A document navigation installs the observer before app startup, not after client construction.
    await page.goto(base + '?regression=' + encodeURIComponent(route) + '#/' + route);
    await page.waitForSelector('h1, h2', { timeout: 30_000 });
    await delay(1200);
    const started = Date.now();
    while (pending.size && Date.now() - started < 90_000) await delay(200);
    pages.push({
      route,
      heading: await page.locator('h1, h2').first().isVisible(),
      completed: pending.size === 0
    });
    console.log(
      JSON.stringify({
        mode,
        page: route,
        pending: pending.size,
        observed: results.length,
        scriptErrors: errors.length
      })
    );
    if (pending.size) break;
  }
  return { pages, scriptErrors: errors, id: randomUUID() };
}
