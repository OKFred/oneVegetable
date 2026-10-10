import type { UiLocale } from '@one-vegetable/core';

import { pageHash, parsePageHash } from './hash-router';

export const GITHUB_FEEDBACK_URL = 'https://github.com/OKFred/oneVegetable/issues/new';
export const FEEDBACK_URL_MAX_LENGTH = 16_000;

export interface FeedbackEnvironmentInput {
  appVersion: string;
  capturedAtUtc: string;
  devicePixelRatio: number;
  mode: 'mock' | 'extension' | 'bff';
  route: string;
  theme: 'light' | 'dark';
  uiLocale: UiLocale;
  userAgent: string;
  viewportHeight: number;
  viewportWidth: number;
}

export function buildGitHubFeedbackUrl(environment: FeedbackEnvironmentInput): string {
  const url = new URL(GITHUB_FEEDBACK_URL);
  url.searchParams.set('template', 'feedback.yml');
  url.searchParams.set('environment', formatFeedbackEnvironment(environment));
  if (url.href.length > FEEDBACK_URL_MAX_LENGTH) throw new Error('FEEDBACK_URL_TOO_LONG');
  return url.href;
}

export function formatFeedbackEnvironment(input: FeedbackEnvironmentInput): string {
  return [
    `oneVegetable: ${normalizeLine(input.appVersion)}`,
    `Mode: ${input.mode}`,
    `Route: ${normalizeFeedbackRoute(input.route)}`,
    `UI locale: ${input.uiLocale}`,
    `Theme: ${input.theme}`,
    `Browser: ${browserSummary(input.userAgent)}`,
    `OS: ${operatingSystemSummary(input.userAgent)}`,
    `Viewport: ${positiveInteger(input.viewportWidth)} × ${positiveInteger(input.viewportHeight)} @ ${normalizedRatio(input.devicePixelRatio)}x`,
    `Captured at (UTC): ${normalizedIsoTimestamp(input.capturedAtUtc)}`
  ].join('\n');
}

export function normalizeFeedbackRoute(value: string): string {
  const page = parsePageHash(value.trim());
  return page ? pageHash(page) : '#/dashboard';
}

export function browserSummary(userAgent: string): string {
  const candidates: [RegExp, string][] = [
    [/Edg\/(\d+)/u, 'Edge'],
    [/Chrome\/(\d+)/u, 'Chrome'],
    [/Firefox\/(\d+)/u, 'Firefox'],
    [/Version\/(\d+).+Safari/u, 'Safari']
  ];
  for (const [pattern, name] of candidates) {
    const match = pattern.exec(userAgent);
    if (match?.[1]) return `${name} ${match[1]}`;
  }
  return 'Unknown';
}

export function operatingSystemSummary(userAgent: string): string {
  if (userAgent.includes('Windows NT')) return 'Windows';
  if (userAgent.includes('Android')) return 'Android';
  if (/iPhone|iPad|iPod/u.test(userAgent)) return 'iOS';
  if (userAgent.includes('Mac OS X')) return 'macOS';
  if (userAgent.includes('Linux')) return 'Linux';
  return 'Unknown';
}

function normalizeLine(value: string): string {
  return value
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function positiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizedRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.round(value * 100) / 100;
}

function normalizedIsoTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date(0).toISOString() : parsed.toISOString();
}
