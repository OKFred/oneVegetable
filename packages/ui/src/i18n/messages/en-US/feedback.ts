export const feedback = {
  launcher: 'Send feedback',
  title: 'Send product feedback',
  description:
    'Capture, preview and copy a screenshot here, then write your feedback, paste the image and submit on GitHub. You can also go straight to GitHub.',
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
    failed: 'Screenshot failed. Try again or leave feedback directly on GitHub.',
    tooLarge: 'The screenshot is too large. Reduce the browser window size and try again.',
    copyFailed: 'Could not copy or download the screenshot. Please try again.'
  },
  privacy: {
    title: 'Public content notice',
    description:
      'Screenshots stay on your device and are never uploaded automatically. GitHub issues are public. Check and remove passwords, App Secrets, tokens and buyer information before pasting and submitting.'
  },
  actions: {
    copy: 'Copy screenshot',
    copying: 'Copying…',
    openGitHub: 'Leave feedback on GitHub'
  },
  status: {
    clipboardReady: 'Screenshot copied. Write your feedback on GitHub and press Ctrl+V to paste the image.',
    downloaded:
      'Image clipboard access was unavailable. The screenshot was downloaded; upload it to GitHub manually.'
  }
} as const;
