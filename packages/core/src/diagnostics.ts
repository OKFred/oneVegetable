const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;
const SECRET_ASSIGNMENT_PATTERN =
  /(app[_-]?secret|access[_-]?token|session|authorization)(\s*[:=]\s*)[^\s,;]+/giu;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/gu;

export function sanitizeDiagnosticMessage(message: string): string {
  return message
    .replace(URL_PATTERN, '[url]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1$2[redacted]')
    .replace(LONG_TOKEN_PATTERN, '[redacted]')
    .slice(0, 300);
}
