import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { redoclyReportIssues } from './lib/redocly-report';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const redoclyCliPath = require.resolve('@redocly/cli/bin/cli.js');
const result = spawnSync(
  process.execPath,
  [
    redoclyCliPath,
    'lint',
    'openapi/one-vegetable.json',
    '--config',
    'redocly.yaml',
    '--format',
    'json',
    '--max-problems',
    '1000'
  ],
  {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  }
);

if (result.error) throw result.error;

let report: unknown;
try {
  report = JSON.parse(result.stdout);
} catch {
  throw new Error(`Redocly did not return a JSON report.\n${result.stderr.trim()}`);
}

const issues = redoclyReportIssues(report);
if (result.status !== 0 || issues.length > 0) {
  throw new Error(`Redocly quality gate failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
}

console.log('Redocly quality gate passed with 0 errors and 0 warnings.');
