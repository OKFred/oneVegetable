export const logs = {
  title: 'Logs',
  description: 'Request diagnostics, audit events, and local diagnostics and data in one place.',
  navigation: 'Log categories',
  sections: { requests: 'Request diagnostics', audit: 'Audit events', local: 'Diagnostics & data' },
  checking: 'Checking log access…',
  accessFailed: 'Could not check log access. Sign in again and retry.',
  retry: 'Check again',
  adminOnly: 'Only administrators can view server request diagnostics and audit events.',
  localOnly:
    'This mode provides local diagnostics and data management. Sign in to a BFF administrator account to view server request diagnostics and audit events.'
} as const;
