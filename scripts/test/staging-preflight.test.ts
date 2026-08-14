import { describe, expect, it } from 'vitest';

import { stagingPreflightIssues } from '../lib/staging-preflight';

import type { DeploymentPreflightEnvironment, WranglerConfiguration } from '../lib/staging-preflight';

const validEnvironment: DeploymentPreflightEnvironment = {
  CLOUDFLARE_API_TOKEN: 'configured',
  CLOUDFLARE_ACCOUNT_ID: 'configured',
  STAGING_BASE_URL: 'https://staging.one-vegetable.example.cn',
  CF_ACCESS_CLIENT_ID: 'configured',
  CF_ACCESS_CLIENT_SECRET: 'configured'
};

function validConfiguration(): WranglerConfiguration {
  return {
    compatibility_date: '2026-08-13',
    env: {
      staging: {
        vars: {
          ONE_VEGETABLE_API_PREFIX: '/api/v1',
          ONE_VEGETABLE_ENVIRONMENT: 'staging',
          ONE_VEGETABLE_GATEWAY_MODE: 'replay',
          ONE_VEGETABLE_CORS_ORIGINS: 'https://staging-web.one-vegetable.example.cn',
          ONE_VEGETABLE_MUTATION_FLAGS: ''
        },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'one-vegetable-staging',
            database_id: '11111111-1111-4111-8111-111111111111',
            migrations_dir: 'drizzle'
          }
        ]
      },
      production: {
        workers_dev: false,
        vars: {
          ONE_VEGETABLE_API_PREFIX: '/api/v1',
          ONE_VEGETABLE_ENVIRONMENT: 'production',
          ONE_VEGETABLE_GATEWAY_MODE: 'disabled',
          ONE_VEGETABLE_CORS_ORIGINS: 'https://app.one-vegetable.example.cn',
          ONE_VEGETABLE_MUTATION_FLAGS: ''
        },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'one-vegetable-production',
            database_id: '22222222-2222-4222-8222-222222222222',
            migrations_dir: 'drizzle'
          }
        ]
      }
    }
  };
}

describe('staging deployment preflight', () => {
  it('accepts isolated safe staging and production configuration', () => {
    expect(
      stagingPreflightIssues(validConfiguration(), validEnvironment, {
        now: new Date('2026-08-14T00:00:00.000Z')
      })
    ).toEqual([]);
  });

  it('rejects placeholders, real staging access and enabled mutations', () => {
    const configuration = validConfiguration();
    const staging = configuration.env?.staging;
    if (!staging?.vars || !staging.d1_databases?.[0]) throw new Error('invalid test fixture');
    staging.vars.ONE_VEGETABLE_GATEWAY_MODE = 'real';
    staging.vars.ONE_VEGETABLE_MUTATION_FLAGS = 'operation:publishProduct';
    staging.vars.ONE_VEGETABLE_CORS_ORIGINS = 'https://staging.example.invalid';
    staging.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000002';
    expect(stagingPreflightIssues(configuration, validEnvironment).join('\n')).toMatch(
      /replay|mutation|占位/
    );
  });

  it('does not include secret values in reported environment issues', () => {
    const issues = stagingPreflightIssues(validConfiguration(), {
      ...validEnvironment,
      CF_ACCESS_CLIENT_SECRET: ''
    });
    expect(issues).toContain('部署环境缺少 CF_ACCESS_CLIENT_SECRET');
    expect(issues.join('\n')).not.toContain(validEnvironment.CLOUDFLARE_API_TOKEN);
  });
});
