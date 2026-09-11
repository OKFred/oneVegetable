export const GATEWAY_CONFIGURATION_EVENT = 'one-vegetable:gateway-configuration-changed';
const senderId = crypto.randomUUID();
export function isExternalGatewayConfigurationChange(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'changed' &&
    'senderId' in value &&
    typeof value.senderId === 'string' &&
    value.senderId !== senderId
  );
}
export function notifyGatewayConfigurationChanged(): void {
  globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(GATEWAY_CONFIGURATION_EVENT);
    channel.postMessage({ kind: 'changed', senderId });
    channel.close();
  }
}
