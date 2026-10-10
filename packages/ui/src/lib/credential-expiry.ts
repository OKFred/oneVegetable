const DAY = 86_400_000;
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
