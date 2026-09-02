export const EXTENSION_REVIEW_PROMPT_STORAGE_KEY = 'oneVegetableReviewPrompt';
export const EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
export const CHROME_WEB_STORE_REVIEW_URL =
  'https://chromewebstore.google.com/detail/aepfdoldflokikbbcpnfifkacpfakmjc/reviews';

export interface ExtensionReviewPromptState {
  schemaVersion: 1;
  firstSeenTimeUtc: number;
  lastPromptTimeUtc: number | null;
  reviewLinkOpenedTimeUtc: number | null;
}

export interface ExtensionReviewPromptRepository {
  claimDuePrompt(): Promise<boolean>;
  openStoreReview(): Promise<void>;
}

export interface ExtensionReviewPromptEvaluation {
  due: boolean;
  state: ExtensionReviewPromptState;
}

export function evaluateExtensionReviewPrompt(
  value: unknown,
  now = Date.now()
): ExtensionReviewPromptEvaluation {
  assertTimestamp(now);
  const stored = parseExtensionReviewPromptState(value);
  if (!stored || hasFutureTimestamp(stored, now)) {
    return { due: false, state: createExtensionReviewPromptState(now) };
  }
  if (stored.reviewLinkOpenedTimeUtc !== null) return { due: false, state: stored };

  const referenceTime = stored.lastPromptTimeUtc ?? stored.firstSeenTimeUtc;
  if (now - referenceTime < EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS) {
    return { due: false, state: stored };
  }
  return {
    due: true,
    state: { ...stored, lastPromptTimeUtc: now }
  };
}

export function markExtensionReviewLinkOpened(value: unknown, now = Date.now()): ExtensionReviewPromptState {
  assertTimestamp(now);
  const stored = parseExtensionReviewPromptState(value);
  const state = !stored || hasFutureTimestamp(stored, now) ? createExtensionReviewPromptState(now) : stored;
  return { ...state, reviewLinkOpenedTimeUtc: now };
}

export function parseExtensionReviewPromptState(value: unknown): ExtensionReviewPromptState | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isTimestamp(value.firstSeenTimeUtc)) return null;
  const lastPromptTimeUtc = nullableTimestamp(value.lastPromptTimeUtc);
  const reviewLinkOpenedTimeUtc = nullableTimestamp(value.reviewLinkOpenedTimeUtc);
  if (lastPromptTimeUtc === undefined || reviewLinkOpenedTimeUtc === undefined) return null;
  if (
    (lastPromptTimeUtc !== null && lastPromptTimeUtc < value.firstSeenTimeUtc) ||
    (reviewLinkOpenedTimeUtc !== null && reviewLinkOpenedTimeUtc < value.firstSeenTimeUtc)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    firstSeenTimeUtc: value.firstSeenTimeUtc,
    lastPromptTimeUtc,
    reviewLinkOpenedTimeUtc
  };
}

function createExtensionReviewPromptState(now: number): ExtensionReviewPromptState {
  return {
    schemaVersion: 1,
    firstSeenTimeUtc: now,
    lastPromptTimeUtc: null,
    reviewLinkOpenedTimeUtc: null
  };
}

function hasFutureTimestamp(state: ExtensionReviewPromptState, now: number): boolean {
  return (
    state.firstSeenTimeUtc > now ||
    (state.lastPromptTimeUtc !== null && state.lastPromptTimeUtc > now) ||
    (state.reviewLinkOpenedTimeUtc !== null && state.reviewLinkOpenedTimeUtc > now)
  );
}

function nullableTimestamp(value: unknown): number | null | undefined {
  return value === null ? null : isTimestamp(value) ? value : undefined;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function assertTimestamp(value: number): void {
  if (!isTimestamp(value))
    throw new RangeError('now must be a non-negative Unix epoch millisecond timestamp');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
