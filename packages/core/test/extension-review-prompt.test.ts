import { describe, expect, it } from 'vitest';

import {
  EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS,
  evaluateExtensionReviewPrompt,
  markExtensionReviewLinkOpened
} from '../src/extension-review-prompt';

const NOW = Date.UTC(2026, 8, 2, 8);

describe('extension review prompt state', () => {
  it('starts the seven-day clock without showing on first use', () => {
    expect(evaluateExtensionReviewPrompt(undefined, NOW)).toEqual({
      due: false,
      state: {
        schemaVersion: 1,
        firstSeenTimeUtc: NOW,
        lastPromptTimeUtc: null,
        reviewLinkOpenedTimeUtc: null
      }
    });
  });

  it('becomes due exactly seven days after first use and claims the display time', () => {
    const initial = evaluateExtensionReviewPrompt(undefined, NOW).state;
    expect(
      evaluateExtensionReviewPrompt(initial, NOW + EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS - 1).due
    ).toBe(false);

    const dueAt = NOW + EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS;
    expect(evaluateExtensionReviewPrompt(initial, dueAt)).toEqual({
      due: true,
      state: { ...initial, lastPromptTimeUtc: dueAt }
    });
  });

  it('waits another seven days after a prompt was shown', () => {
    const initial = evaluateExtensionReviewPrompt(undefined, NOW).state;
    const firstClaim = evaluateExtensionReviewPrompt(
      initial,
      NOW + EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS
    ).state;
    expect(evaluateExtensionReviewPrompt(firstClaim, firstClaim.lastPromptTimeUtc ?? NOW).due).toBe(false);
    expect(
      evaluateExtensionReviewPrompt(
        firstClaim,
        (firstClaim.lastPromptTimeUtc ?? NOW) + EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS
      ).due
    ).toBe(true);
  });

  it('never prompts again after the review link was opened', () => {
    const initial = evaluateExtensionReviewPrompt(undefined, NOW).state;
    const reviewed = markExtensionReviewLinkOpened(initial, NOW + 1_000);
    expect(
      evaluateExtensionReviewPrompt(reviewed, NOW + EXTENSION_REVIEW_PROMPT_INTERVAL_MILLISECONDS * 10).due
    ).toBe(false);
  });

  it('silently restarts the clock for corrupt or future state', () => {
    expect(evaluateExtensionReviewPrompt({ schemaVersion: 1 }, NOW)).toEqual(
      evaluateExtensionReviewPrompt(undefined, NOW)
    );
    expect(
      evaluateExtensionReviewPrompt(
        {
          schemaVersion: 1,
          firstSeenTimeUtc: NOW + 1,
          lastPromptTimeUtc: null,
          reviewLinkOpenedTimeUtc: null
        },
        NOW
      )
    ).toEqual(evaluateExtensionReviewPrompt(undefined, NOW));
  });
});
