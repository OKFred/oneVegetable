import { domToBlob, type Options as DomScreenshotOptions } from 'modern-screenshot';

export const FEEDBACK_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024;
export const FEEDBACK_SCREENSHOT_MAX_DIMENSION = 1600;

const REDACTED_TEXT = '••••••';
const MIN_RENDER_SCALE = 0.25;
const SCALE_REDUCTION = 0.75;

export interface FeedbackScreenshot {
  blob: Blob;
  fileName: string;
  height: number;
  width: number;
}

export interface FeedbackScreenshotCaptureOptions {
  maxBytes?: number;
  maxDimension?: number;
  now?: Date;
  renderer?: FeedbackScreenshotRenderer;
  viewportHeight?: number;
  viewportWidth?: number;
}

export type FeedbackScreenshotRenderer = (node: HTMLElement, options: DomScreenshotOptions) => Promise<Blob>;

export async function captureFeedbackScreenshot(
  root: HTMLElement,
  options: FeedbackScreenshotCaptureOptions = {}
): Promise<FeedbackScreenshot> {
  const viewportWidth = positiveInteger(options.viewportWidth ?? globalThis.innerWidth);
  const viewportHeight = positiveInteger(options.viewportHeight ?? globalThis.innerHeight);
  const maxDimension = positiveInteger(options.maxDimension ?? FEEDBACK_SCREENSHOT_MAX_DIMENSION);
  const maxBytes = positiveInteger(options.maxBytes ?? FEEDBACK_SCREENSHOT_MAX_BYTES);
  const renderer = options.renderer ?? domToBlob;
  let scale = Math.min(1, maxDimension / Math.max(viewportWidth, viewportHeight));

  while (scale >= MIN_RENDER_SCALE) {
    const blob = await renderer(root, {
      width: viewportWidth,
      height: viewportHeight,
      scale,
      backgroundColor: resolvedBackgroundColor(root),
      filter: shouldIncludeFeedbackNode,
      onCloneEachNode: redactFeedbackClone,
      timeout: 10_000,
      fetch: {
        requestInit: { cache: 'no-store', credentials: 'omit' },
        bypassingCache: true,
        placeholderImage: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
      },
      features: { restoreScrollPosition: true }
    });
    if (blob.size <= maxBytes) {
      return {
        blob,
        fileName: feedbackScreenshotFileName(options.now),
        width: Math.max(1, Math.round(viewportWidth * scale)),
        height: Math.max(1, Math.round(viewportHeight * scale))
      };
    }
    scale *= SCALE_REDUCTION;
  }

  throw new Error('FEEDBACK_SCREENSHOT_TOO_LARGE');
}

export function shouldIncludeFeedbackNode(node: Node): boolean {
  return !(node instanceof Element && node.closest('[data-feedback-ignore]'));
}

export function redactFeedbackClone(node: Node): void {
  if (!(node instanceof HTMLElement)) return;
  if (!isSensitiveFeedbackElement(node)) return;

  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    node.value = REDACTED_TEXT;
    node.setAttribute('value', REDACTED_TEXT);
    node.setAttribute('placeholder', REDACTED_TEXT);
    return;
  }

  node.replaceChildren(node.ownerDocument.createTextNode(REDACTED_TEXT));
  node.style.color = 'transparent';
  node.style.textShadow = '0 0 8px currentColor';
  node.style.userSelect = 'none';
}

export function feedbackScreenshotFileName(now = new Date()): string {
  const iso = now
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z');
  return `one-vegetable-feedback-${iso}.png`;
}

function isSensitiveFeedbackElement(element: HTMLElement): boolean {
  return (
    element.hasAttribute('data-feedback-redact') ||
    (element instanceof HTMLInputElement &&
      (element.type === 'password' || element.autocomplete.includes('password')))
  );
}

function positiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

function resolvedBackgroundColor(root: HTMLElement): string {
  const color = globalThis.getComputedStyle(root).backgroundColor;
  return color && color !== 'rgba(0, 0, 0, 0)' ? color : '#ffffff';
}
