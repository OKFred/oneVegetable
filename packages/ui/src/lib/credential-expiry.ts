const DAY = 86_400_000;

/** Use the current token's recorded lifetime, never permission/import time or a guessed duration. */
export function credentialExpiryTone(
  expires: number | null | undefined,
  captured: number | null | undefined,
  now: number
): 'normal' | 'warning' | 'danger' {
  const state = credentialExpiryState(expires, now).status;
  if (state === 'unknown' || !Number.isSafeInteger(now)) return 'normal';
  if (state === 'expired') return 'danger';
  if (
    expires == null ||
    captured == null ||
    !Number.isSafeInteger(captured) ||
    captured < 0 ||
    captured > now ||
    captured >= expires
  )
    return state === 'expiring' ? 'warning' : 'normal';
  const remaining = expires - now;
  const lifetime = expires - captured;
  return remaining < lifetime / 4 ? 'danger' : remaining < lifetime / 2 ? 'warning' : 'normal';
}
/** Seven days is our reminder window, not an Alibaba token lifetime. */
export function credentialExpiryState(
  expires: number | null | undefined,
  now: number
): {
  status: 'unknown' | 'expired' | 'expiring' | 'valid';
  count: number;
  unit: 'days' | 'hours' | 'minutes';
} {
  if (expires == null || !Number.isSafeInteger(expires) || expires < 0 || expires > 8_640_000_000_000_000)
    return { status: 'unknown' as const, count: 0, unit: 'minutes' as const };
  const remaining = expires - now;
  const unit = remaining >= DAY ? 'days' : remaining >= 3_600_000 ? 'hours' : 'minutes';
  return {
    status:
      remaining <= 0
        ? ('expired' as const)
        : remaining <= 7 * DAY
          ? ('expiring' as const)
          : ('valid' as const),
    count: Math.max(
      0,
      Math.floor(remaining / (unit === 'days' ? DAY : unit === 'hours' ? 3_600_000 : 60_000))
    ),
    unit
  };
}
