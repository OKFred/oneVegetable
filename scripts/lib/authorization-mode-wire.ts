import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { NetworkTransport } from '../../packages/core/src/network';
import type { MatrixGuard, Protocol, ReadRule, ReadWireEvent } from './authorization-mode-regression';

/** Independent boundary: only an armed read, once per semantic payload, no Token or write paths. */
export class ReadWireGuard implements MatrixGuard {
  private active: {
    id: string;
    rule: ReadRule;
    expected: Protocol | null;
    sent: number;
    used: Set<string>;
  } | null = null;
  private events: ReadWireEvent[] = [];
  private blocked = 0;
  private denied: { protocol: Protocol; method: string; reason: string }[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private lastStarted = 0;
  arm(id: string, rule: ReadRule, expected: Protocol | null): void {
    if (this.active) throw new Error('READ_GUARD_ALREADY_ARMED');
    this.active = { id, rule, expected, sent: 0, used: new Set() };
  }
  disarm(): void {
    this.active = null;
  }
  snapshot() {
    return { events: [...this.events], blocked: this.blocked, denied: [...this.denied] };
  }
  async send(request: Request, next: () => Promise<Response>): Promise<Response> {
    const execute = async () => {
      const current = this.active,
        url = new URL(request.url);
      const form = new URLSearchParams(await request.clone().text());
      const protocol: Protocol = url.origin === 'https://eco.taobao.com' ? 'top' : 'iop';
      const method = protocol === 'top' ? (form.get('method') ?? '') : url.pathname;
      const deny = (reason = 'envelope'): never => {
        this.blocked++;
        this.denied.push({
          protocol,
          method: current?.rule[protocol].includes(method) ? method : 'redacted',
          reason
        });
        throw new Error('READ_ONLY_NETWORK_DENIED');
      };
      if (
        protocol !== current?.expected ||
        !(protocol === 'top'
          ? url.origin === 'https://eco.taobao.com' && url.pathname === '/router/rest'
          : url.origin === 'https://openapi-api.alibaba.com') ||
        !current.rule[protocol].includes(method) ||
        request.method !== 'POST' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        request.headers.get('X-Request-ID') !== current.id ||
        this.events.length >= 180 ||
        form.has('refresh_token') ||
        form.has('code')
      )
        return deny();
      const parameters = [...form]
        .filter(
          ([key]) =>
            ![
              'app_key',
              'sign',
              'sign_method',
              'access_token',
              'session',
              'timestamp',
              'format',
              'v',
              'partner_id'
            ].includes(key)
        )
        .sort(([a], [b]) => a.localeCompare(b));
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([method, parameters]))
        .digest('hex');
      if (current.used.has(fingerprint)) return deny('duplicate');
      if (current.sent >= current.rule.limit) return deny('request-limit');
      current.used.add(fingerprint);
      await delay(Math.max(0, 350 - (Date.now() - this.lastStarted)));
      if (current !== this.active) return deny();
      current.sent++;
      this.lastStarted = Date.now();
      const event: ReadWireEvent = { protocol, method, requestId: current.id, status: 0 };
      this.events.push(event);
      const response = await next();
      event.status = response.status;
      return response;
    };
    const result = this.tail.then(execute);
    this.tail = result.catch(() => undefined);
    return result;
  }
  transport(next: NetworkTransport): NetworkTransport {
    return {
      send: (input, init) =>
        this.send(new Request(input, init), () => next.send(input, { ...init, redirect: 'error' }))
    };
  }
}
