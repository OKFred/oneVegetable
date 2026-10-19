// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transientMessage } from '../../auth-pages/src/dom';
import { zh } from '@one-vegetable/core/iop-messages';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<main><p id="notice" role="status"></p><p id="error" role="alert"></p></main>';
});
afterEach(() => {
  transientMessage('');
  transientMessage('', true);
  vi.useRealTimers();
  document.body.replaceChildren();
});
describe('authorization transient notifications', () => {
  it('moves progress out of the form layout, then dismisses after four seconds', () => {
    transientMessage(zh.discoveringApplication);
    const content = document.querySelector('#notice');
    expect(content?.closest('main')).toBeNull();
    expect(content?.closest<HTMLElement>('.authorization-toast')?.hidden).toBe(false);
    vi.advanceTimersByTime(4000);
    expect(content?.textContent).toBe('');
    expect(content?.closest<HTMLElement>('.authorization-toast')?.hidden).toBe(true);
  });
  it('shows an error for six seconds and supports explicit dismissal', () => {
    transientMessage(zh.AUTH_INPUT_INVALID, true);
    const content = document.querySelector('#error');
    vi.advanceTimersByTime(5000);
    expect(content?.textContent).toBe(zh.AUTH_INPUT_INVALID);
    vi.advanceTimersByTime(1000);
    expect(content?.closest<HTMLElement>('.authorization-toast')?.hidden).toBe(true);
    transientMessage(zh.IOP_APP_SECURITY_CHECK, true);
    content?.closest('.authorization-toast')?.querySelector<HTMLButtonElement>('button')?.click();
    expect(content?.textContent).toBe('');
  });
  it('replaces the same message slot without accumulating notifications or timers', () => {
    transientMessage(zh.discoveringApplication);
    vi.advanceTimersByTime(3000);
    transientMessage(zh.applicationRead);
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('#notice')?.textContent).toBe(zh.applicationRead);
    expect(document.querySelectorAll('#notice')).toHaveLength(1);
    expect(document.querySelectorAll('.authorization-toast')).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(document.querySelector('#notice')?.textContent).toBe('');
  });
});
