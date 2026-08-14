import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { stagingPreflightIssues } from './lib/staging-preflight';

import type { DeploymentPreflightEnvironment, WranglerConfiguration } from './lib/staging-preflight';

const root = resolve(import.meta.dirname, '..');
const argumentsSet = new Set(process.argv.slice(2));
const allowPlaceholders = argumentsSet.has('--allow-placeholders');
const requireDeploymentEnvironment = !argumentsSet.has('--skip-deployment-environment');
const configuration = JSON.parse(
  await readFile(resolve(root, 'apps/api/wrangler.jsonc'), 'utf8')
) as WranglerConfiguration;
const environment = process.env as unknown as DeploymentPreflightEnvironment;
const issues = stagingPreflightIssues(configuration, environment, {
  allowPlaceholders,
  requireDeploymentEnvironment
});

if (issues.length > 0) {
  throw new Error(`staging preflight 未通过：\n- ${issues.join('\n- ')}`);
}
process.stdout.write(
  `staging preflight passed placeholders=${allowPlaceholders ? 'allowed' : 'denied'} deploymentEnvironment=${requireDeploymentEnvironment ? 'required' : 'skipped'}\n`
);
