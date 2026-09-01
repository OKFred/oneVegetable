import { RELEASE_NOTES_DOCUMENT } from './generated/release-notes';

export const RELEASE_CHANGE_TYPES = ['feature', 'improvement', 'fix', 'security'] as const;

export type ReleaseChangeType = (typeof RELEASE_CHANGE_TYPES)[number];
export type ReleaseNoteSource = 'release' | 'tag';
export type ReleaseNoteLocale = 'zh-CN' | 'en-US';

export interface LocalizedReleaseText {
  'zh-CN': string;
  'en-US': string;
}

export interface ReleaseNoteChange {
  type: ReleaseChangeType;
  title: LocalizedReleaseText;
  description: LocalizedReleaseText;
}

export interface ReleaseNote {
  version: string;
  releasedAt: string;
  title: LocalizedReleaseText;
  summary: LocalizedReleaseText;
  source: ReleaseNoteSource;
  githubUrl: string;
  compareUrl: string | null;
  changes: readonly ReleaseNoteChange[];
}

export const RELEASE_NOTES_REPOSITORY_URL = RELEASE_NOTES_DOCUMENT.repositoryUrl;
export const RELEASE_NOTES: readonly ReleaseNote[] = RELEASE_NOTES_DOCUMENT.releases;

export function releaseNoteText(value: LocalizedReleaseText, locale: ReleaseNoteLocale): string {
  return value[locale];
}
