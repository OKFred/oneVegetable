import { STORE_EXTENSION_ID } from '@one-vegetable/core/alibaba-iop';
interface ChromeBridge {
  runtime?: {
    lastError?: { message?: string };
    sendMessage(id: string, message: unknown, callback: (response: unknown) => void): void;
  };
}
export function bridge(
  action: 'probe' | 'open' | 'callback',
  payload: Record<string, string> = {}
): Promise<unknown> {
  const runtime = (window as Window & { chrome?: ChromeBridge }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error('extension-required'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('extension-required'));
    }, 40_000);
    try {
      runtime.sendMessage(
        STORE_EXTENSION_ID,
        { kind: 'one-vegetable-public-auth', requestId: crypto.randomUUID(), action, ...payload },
        (response) => {
          clearTimeout(timer);
          if (runtime.lastError) reject(new Error('extension-required'));
          else resolve(response);
        }
      );
    } catch {
      clearTimeout(timer);
      reject(new Error('extension-required'));
    }
  });
}
export function isSuccessful(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === true;
}
