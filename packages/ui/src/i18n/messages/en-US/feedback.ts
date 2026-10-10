export const feedback = {
  launcher: 'Send feedback',
  title: 'Send product feedback',
  description: 'Enter a title and details to open GitHub. Screenshots are optional; review and submit there.',
  kind: {
    label: 'Feedback type',
    bug: 'Problem',
    experience: 'UX feedback',
    feature: 'Feature request',
    formValue: {
      bug: '问题 / Bug',
      experience: '体验建议 / UX feedback',
      feature: '功能建议 / Feature request'
    }
  },
  fields: {
    title: 'Title',
    titlePlaceholder: 'Summarize the problem or suggestion',
    details: 'Details',
    detailsPlaceholder: 'What happened, and what did you expect?',
    reproduction: 'Reproduction steps (optional)',
    reproductionPlaceholder: '1. Open…\n2. Select…\n3. Observe…'
  },
  screenshot: {
    title: 'Current page screenshot (optional)',
    description:
      'The current app viewport is captured only when you click. The feedback UI and marked sensitive content are excluded.',
    capture: 'Capture current page',
    capturing: 'Capturing…',
    retake: 'Retake',
    remove: 'Remove screenshot',
    previewAlt: 'Screenshot ready to submit',
    metadata: '{width} × {height} · {size}',
    failed: 'Screenshot failed. Retry or continue with text only.',
    tooLarge: 'The screenshot is too large. Reduce the browser window size and try again.'
  },
  privacy: {
    title: 'Public content notice',
    description:
      'The GitHub issue and screenshot will be public. Confirm that they contain no passwords, App Secrets, tokens, buyer information, or other data that should remain private.',
    acknowledge: 'I reviewed the text and screenshot and they are safe to publish.'
  },
  actions: {
    openGitHub: 'Copy screenshot, open GitHub, and paste',
    openTextIssue: 'Continue on GitHub',
    opening: 'Preparing GitHub…'
  },
  readiness: {
    title: 'Enter a title with at least 3 characters.',
    details: 'Enter at least 10 characters in Details.',
    acknowledgement: 'Confirm that the feedback is safe to publish.',
    ready: 'Ready. Review and submit on GitHub.'
  },
  status: {
    clipboardReady: 'Screenshot copied. Paste it into the GitHub screenshot field with Ctrl+V.',
    downloaded:
      'Image clipboard access was unavailable. The screenshot was downloaded; upload it to GitHub manually.',
    popupBlocked: 'The GitHub page was blocked. Allow pop-ups and try again.'
  },
  errors: {
    invalid: 'Enter a title and detailed description.',
    urlTooLong: 'The feedback is too long to prefill safely. Shorten the details or reproduction steps.'
  }
} as const;
