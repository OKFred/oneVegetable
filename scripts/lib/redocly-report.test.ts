import { describe, expect, it } from 'vitest';

import { redoclyReportIssues } from './redocly-report';

describe('Redocly JSON report gate', () => {
  it('accepts a report without errors or warnings', () => {
    expect(
      redoclyReportIssues({
        totals: { errors: 0, warnings: 0, ignored: 0 },
        problems: []
      })
    ).toEqual([]);
  });

  it('turns any new warning into a quality gate failure', () => {
    expect(
      redoclyReportIssues({
        totals: { errors: 0, warnings: 1, ignored: 0 },
        problems: [
          {
            severity: 'warn',
            ruleId: 'example-rule',
            message: 'Example warning'
          }
        ]
      })
    ).toEqual(['Redocly reported 0 error(s) and 1 warning(s).', 'warn example-rule: Example warning']);
  });

  it('rejects malformed reports instead of silently accepting them', () => {
    expect(redoclyReportIssues({ problems: [] })).toEqual(['Redocly returned an invalid JSON report.']);
  });
});
