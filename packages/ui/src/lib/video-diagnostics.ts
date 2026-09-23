/** Keep accepted platform omissions out of the UI without changing the response diagnostics. */
export function visibleVideoIssues(issues: readonly string[]): string[] {
  return issues.filter((issue) => issue !== 'result/msg_code:not-returned');
}
