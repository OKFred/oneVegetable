export const RELEASE_CHANGE_TYPES = ['feature', 'improvement', 'fix', 'security'] as const;
export const RELEASE_NOTE_SOURCES = ['release', 'tag'] as const;

export type ReleaseChangeType = (typeof RELEASE_CHANGE_TYPES)[number];
export type ReleaseNoteSource = (typeof RELEASE_NOTE_SOURCES)[number];

export interface ReleaseNoteChange {
  type: ReleaseChangeType;
  title: string;
  description: string;
}

export interface ReleaseNote {
  version: string;
  releasedAt: string;
  title: string;
  summary: string;
  source: ReleaseNoteSource;
  githubUrl: string;
  compareUrl: string | null;
  changes: ReleaseNoteChange[];
}

export interface ReleaseNotesDocument {
  schemaVersion: 1;
  repositoryUrl: string;
  releases: ReleaseNote[];
}

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseReleaseNotesDocument(value: unknown): ReleaseNotesDocument {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new Error('Release notes must be a JSON object.');
  }

  if (value.schemaVersion !== 1) {
    issues.push('schemaVersion must be 1');
  }
  const repositoryUrl = readString(value.repositoryUrl, 'repositoryUrl', issues);
  if (repositoryUrl && !isGitHubUrl(repositoryUrl)) {
    issues.push('repositoryUrl must be an HTTPS github.com URL');
  }

  const releases: ReleaseNote[] = [];
  if (!Array.isArray(value.releases) || value.releases.length === 0) {
    issues.push('releases must be a non-empty array');
  } else {
    value.releases.forEach((entry, index) => {
      const release = parseReleaseNote(entry, index, issues);
      if (release) releases.push(release);
    });
  }

  const versions = new Set<string>();
  releases.forEach((release, index) => {
    if (versions.has(release.version)) {
      issues.push(`releases[${index}].version duplicates ${release.version}`);
    }
    versions.add(release.version);
    const previous = releases[index - 1];
    if (previous && compareStableVersions(previous.version, release.version) <= 0) {
      issues.push('releases must be sorted by version from newest to oldest');
    }
  });

  if (issues.length > 0) {
    throw new Error(`Invalid release notes:\n- ${issues.join('\n- ')}`);
  }
  return { schemaVersion: 1, repositoryUrl, releases };
}

export function releaseVersionFromTag(tag: string): string {
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`Release tag must be a stable SemVer value; received ${tag || '(empty)'}.`);
  }
  return version;
}

export function findReleaseNote(document: ReleaseNotesDocument, tag: string): ReleaseNote {
  const version = releaseVersionFromTag(tag);
  const release = document.releases.find((candidate) => candidate.version === version);
  if (!release) {
    throw new Error(`Release notes do not contain v${version}.`);
  }
  return release;
}

export function renderReleaseNotesMarkdown(release: ReleaseNote): string {
  const categoryLabels: Record<ReleaseChangeType, string> = {
    feature: '新增',
    improvement: '改进',
    fix: '修复',
    security: '安全'
  };
  const sections = RELEASE_CHANGE_TYPES.map((type) => ({
    type,
    items: release.changes.filter((change) => change.type === type)
  })).filter((section) => section.items.length > 0);

  const lines = [release.summary];
  for (const section of sections) {
    lines.push('', `## ${categoryLabels[section.type]}`);
    for (const item of section.items) {
      lines.push(`- **${item.title}**：${item.description}`);
    }
  }
  if (release.compareUrl) {
    lines.push('', `[查看完整代码差异](${release.compareUrl})`);
  }
  return `${lines.join('\n')}\n`;
}

function parseReleaseNote(value: unknown, index: number, issues: string[]): ReleaseNote | null {
  const path = `releases[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }

  const version = readString(value.version, `${path}.version`, issues);
  if (version && !STABLE_VERSION.test(version)) {
    issues.push(`${path}.version must be stable SemVer without a v prefix`);
  }
  const releasedAt = readString(value.releasedAt, `${path}.releasedAt`, issues);
  if (releasedAt && (!RELEASE_DATE.test(releasedAt) || Number.isNaN(Date.parse(`${releasedAt}T00:00:00Z`)))) {
    issues.push(`${path}.releasedAt must be a valid YYYY-MM-DD date`);
  }
  const title = readString(value.title, `${path}.title`, issues);
  const summary = readString(value.summary, `${path}.summary`, issues);
  const source = readSource(value.source, `${path}.source`, issues);
  const githubUrl = readString(value.githubUrl, `${path}.githubUrl`, issues);
  if (githubUrl && !isGitHubUrl(githubUrl)) {
    issues.push(`${path}.githubUrl must be an HTTPS github.com URL`);
  }
  const compareUrl = readNullableString(value.compareUrl, `${path}.compareUrl`, issues);
  if (compareUrl && !isGitHubUrl(compareUrl)) {
    issues.push(`${path}.compareUrl must be an HTTPS github.com URL or null`);
  }

  const changes: ReleaseNoteChange[] = [];
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    issues.push(`${path}.changes must be a non-empty array`);
  } else {
    value.changes.forEach((change, changeIndex) => {
      const parsed = parseReleaseChange(change, `${path}.changes[${changeIndex}]`, issues);
      if (parsed) changes.push(parsed);
    });
  }

  return { version, releasedAt, title, summary, source, githubUrl, compareUrl, changes };
}

function parseReleaseChange(value: unknown, path: string, issues: string[]): ReleaseNoteChange | null {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  const type = readChangeType(value.type, `${path}.type`, issues);
  const title = readString(value.title, `${path}.title`, issues);
  const description = readString(value.description, `${path}.description`, issues);
  return { type, title, description };
}

function readString(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${path} must be a non-empty string`);
    return '';
  }
  return value.trim();
}

function readNullableString(value: unknown, path: string, issues: string[]): string | null {
  if (value === null) return null;
  return readString(value, path, issues);
}

function readChangeType(value: unknown, path: string, issues: string[]): ReleaseChangeType {
  if (typeof value === 'string' && isReleaseChangeType(value)) return value;
  issues.push(`${path} must be one of ${RELEASE_CHANGE_TYPES.join(', ')}`);
  return 'improvement';
}

function readSource(value: unknown, path: string, issues: string[]): ReleaseNoteSource {
  if (typeof value === 'string' && isReleaseNoteSource(value)) return value;
  issues.push(`${path} must be one of ${RELEASE_NOTE_SOURCES.join(', ')}`);
  return 'tag';
}

function isReleaseChangeType(value: string): value is ReleaseChangeType {
  return RELEASE_CHANGE_TYPES.some((candidate) => candidate === value);
}

function isReleaseNoteSource(value: string): value is ReleaseNoteSource {
  return RELEASE_NOTE_SOURCES.some((candidate) => candidate === value);
}

function isGitHubUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com';
  } catch {
    return false;
  }
}

function compareStableVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
