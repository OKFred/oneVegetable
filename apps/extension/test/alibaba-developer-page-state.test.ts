// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  focusNextRegistrationFieldInFrame,
  inspectApplicationPageStateInFrame,
  selectAlibabaApplicationPageState
} from '../lib/alibaba-credential-page-driver';

interface Scenario {
  html: string;
}

const scenarios = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../mock/data/alibaba-auth/developer-page-scenarios.json'),
    'utf8'
  )
) as Record<string, Scenario>;

describe('Alibaba developer prerequisite page state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it.each([
    ['registrationRequired', 'developer-registration-required'],
    ['underReview', 'developer-registration-under-review'],
    ['registrationRejected', 'developer-registration-rejected'],
    ['applicationRequired', 'application-required'],
    ['applicationNotReady', 'application-not-ready']
  ])('classifies %s without returning registration values', (scenarioName, reasonCode) => {
    document.body.innerHTML = requireScenario(scenarioName).html;

    const result = inspectApplicationPageStateInFrame();

    expect(result).toMatchObject({ kind: 'prerequisite', reasonCode });
    expect(JSON.stringify(result)).not.toMatch(/Example Trading|EXAMPLE-REGISTRATION|Example Street|310000/u);
  });

  it('recognizes an online application as ready', () => {
    document.body.innerHTML = requireScenario('applicationReady').html;

    expect(inspectApplicationPageStateInFrame()).toEqual({ kind: 'ready' });
  });

  it('keeps challenge and login precedence across frames while preferring a real app over navigation text', () => {
    expect(
      selectAlibabaApplicationPageState([
        { kind: 'navigation-ready' },
        { kind: 'prerequisite', reasonCode: 'developer-registration-under-review', registration: null },
        { kind: 'challenge' }
      ])
    ).toEqual({ kind: 'challenge' });
    expect(selectAlibabaApplicationPageState([{ kind: 'navigation-ready' }, { kind: 'ready' }])).toEqual({
      kind: 'ready'
    });
  });

  it('focuses and highlights the first missing registration field without filling it', () => {
    document.body.innerHTML = requireScenario('registrationRequired').html;

    expect(focusNextRegistrationFieldInFrame()).toBe('bizRegistNumber');
    expect(document.activeElement?.id).toBe('bizRegistNumber');
    expect((document.activeElement as HTMLInputElement).value).toBe('');
  });
});

function requireScenario(name: string): Scenario {
  const scenario = scenarios[name];
  if (!scenario) throw new Error(`Missing Alibaba developer page scenario: ${name}`);
  return scenario;
}
