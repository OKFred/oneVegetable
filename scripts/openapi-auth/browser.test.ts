// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { detectAlibabaDeveloperPrerequisite } from './browser';

import type { Page } from '@playwright/test';

interface Scenario {
  html: string;
}

const scenarios = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../mock/data/alibaba-auth/developer-page-scenarios.json'),
    'utf8'
  )
) as Record<string, Scenario>;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Node Playwright Alibaba developer prerequisite detection', () => {
  it.each([
    ['registrationRequired', 'developer-registration-required'],
    ['underReview', 'developer-registration-under-review'],
    ['registrationRejected', 'developer-registration-rejected'],
    ['applicationRequired', 'application-required'],
    ['applicationNotReady', 'application-not-ready'],
    ['applicationReady', null]
  ])('classifies the sanitized %s page without returning field values', async (scenarioName, expected) => {
    document.body.innerHTML = requireScenario(scenarioName).html;

    const result = await detectAlibabaDeveloperPrerequisite(fakePage());

    expect(result).toBe(expected);
    expect(JSON.stringify(result)).not.toMatch(/Example Trading|EXAMPLE-REGISTRATION|Example Street|310000/u);
  });
});

function fakePage(): Page {
  return {
    frames: () => [
      {
        locator: () => ({
          evaluate: (callback: () => unknown) => Promise.resolve(callback())
        })
      }
    ]
  } as unknown as Page;
}

function requireScenario(name: string): Scenario {
  const scenario = scenarios[name];
  if (!scenario) throw new Error(`Missing Alibaba developer page scenario: ${name}`);
  return scenario;
}
