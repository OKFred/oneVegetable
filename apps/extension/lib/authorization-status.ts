import type { IopAuthorizationSummary } from './iop-authorization';

/** Local status only: never refreshes tokens or calls Alibaba. */
export function authorizationStatusPollDelay(
  state: IopAuthorizationSummary['state'] | undefined,
  visible: boolean
): number | null {
  // Keep observing the callback while the user is on the provider's tab.
  if (state === 'waiting' || state === 'busy') return 5000;
  // A visible tool must not retain stale "saved" state after worker termination.
  // Hidden, idle tools do not keep the worker alive.
  return visible && state !== undefined ? 15_000 : null;
}
