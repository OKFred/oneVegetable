export function redoclyReportIssues(reportValue: unknown): string[] {
  const report = asRecord(reportValue);
  const totals = asRecord(report?.totals);
  const errors = nonNegativeInteger(totals?.errors);
  const warnings = nonNegativeInteger(totals?.warnings);

  if (!report || !totals || errors === undefined || warnings === undefined) {
    return ['Redocly returned an invalid JSON report.'];
  }
  if (errors === 0 && warnings === 0) return [];

  const issues = [`Redocly reported ${errors} error(s) and ${warnings} warning(s).`];
  if (!Array.isArray(report.problems)) return issues;

  for (const problemValue of report.problems) {
    const problem = asRecord(problemValue);
    if (!problem) continue;
    const severity = typeof problem.severity === 'string' ? problem.severity : 'problem';
    const ruleId = typeof problem.ruleId === 'string' ? problem.ruleId : 'unknown-rule';
    const message = typeof problem.message === 'string' ? problem.message : 'No message';
    issues.push(`${severity} ${ruleId}: ${message}`);
  }

  return issues;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
