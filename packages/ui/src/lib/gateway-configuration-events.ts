export const GATEWAY_CONFIGURATION_EVENT = 'one-vegetable:gateway-configuration-changed';
export function notifyGatewayConfigurationChanged(): void {
  globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(GATEWAY_CONFIGURATION_EVENT);
    channel.postMessage('changed');
    channel.close();
  }
}
