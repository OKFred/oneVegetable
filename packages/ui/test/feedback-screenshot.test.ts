// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  captureFeedbackScreenshot,
  feedbackScreenshotFileName,
  redactFeedbackClone,
  shouldIncludeFeedbackNode,
  type FeedbackScreenshotRenderer
} from '../src/lib/feedback-screenshot';

describe('feedback screenshot', () => {
  it('excludes feedback chrome and masks explicit and password values', () => {
    const ignored = document.createElement('div');
    ignored.dataset.feedbackIgnore = '';
    const child = document.createElement('button');
    ignored.append(child);

    expect(shouldIncludeFeedbackNode(ignored)).toBe(false);
    expect(shouldIncludeFeedbackNode(child)).toBe(false);

    const password = document.createElement('input');
    password.type = 'password';
    password.value = 'real-secret';
    redactFeedbackClone(password);
    expect(password.value).toBe('••••••');
    expect(password.getAttribute('value')).toBe('••••••');

    const token = document.createElement('p');
    token.dataset.feedbackRedact = '';
    token.textContent = 'access-token';
    redactFeedbackClone(token);
    expect(token.textContent).toBe('••••••');
  });

  it('scales screenshots down until they fit the attachment budget', async () => {
    const root = document.createElement('main');
    const renderer = vi
      .fn<FeedbackScreenshotRenderer>()
      .mockResolvedValueOnce(new Blob([new Uint8Array(101)], { type: 'image/png' }))
      .mockResolvedValueOnce(new Blob([new Uint8Array(80)], { type: 'image/png' }));

    const screenshot = await captureFeedbackScreenshot(root, {
      viewportWidth: 2000,
      viewportHeight: 1000,
      maxDimension: 1600,
      maxBytes: 100,
      now: new Date('2026-09-02T03:04:05.000Z'),
      renderer
    });

    expect(renderer).toHaveBeenCalledTimes(2);
    expect(renderer.mock.calls[0]?.[1].scale).toBe(0.8);
    expect(renderer.mock.calls[1]?.[1].scale).toBeCloseTo(0.6);
    expect(screenshot.width).toBe(1200);
    expect(screenshot.height).toBe(600);
    expect(screenshot.fileName).toBe('one-vegetable-feedback-20260902T030405Z.png');
  });

  it('generates a filesystem-safe UTC file name', () => {
    expect(feedbackScreenshotFileName(new Date('2026-09-02T11:12:13.456Z'))).toBe(
      'one-vegetable-feedback-20260902T111213Z.png'
    );
  });
});
