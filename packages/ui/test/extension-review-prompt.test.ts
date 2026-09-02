// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExtensionReviewPrompt from '../src/components/ExtensionReviewPrompt.vue';

afterEach(() => {
  globalThis.document.body.replaceChildren();
});

describe('ExtensionReviewPrompt', () => {
  it('stays hidden when the prompt is not due', async () => {
    const wrapper = mount(ExtensionReviewPrompt, {
      attachTo: globalThis.document.body,
      props: {
        repository: {
          claimDuePrompt: () => Promise.resolve(false),
          openStoreReview: () => Promise.resolve()
        }
      }
    });
    await flushPromises();

    expect(globalThis.document.body.textContent).not.toContain('用得不错？赏个评价。');
    wrapper.unmount();
  });

  it('shows two actions and opens the store review through the repository', async () => {
    const openStoreReview = vi.fn(() => Promise.resolve());
    const wrapper = mount(ExtensionReviewPrompt, {
      attachTo: globalThis.document.body,
      props: {
        repository: {
          claimDuePrompt: () => Promise.resolve(true),
          openStoreReview
        }
      }
    });
    await flushPromises();

    expect(globalThis.document.body.textContent).toContain('用得不错？赏个评价。');
    expect(actionButtons().map((button) => button.textContent.trim())).toEqual(['以后再说', '去评价']);
    expect(globalThis.document.body.querySelector('[aria-label^="关闭"]')).toBeNull();

    actionButton('去评价').click();
    await flushPromises();

    expect(openStoreReview).toHaveBeenCalledOnce();
    expect(globalThis.document.body.textContent).not.toContain('用得不错？赏个评价。');
    wrapper.unmount();
  });

  it('keeps the dialog open when the store cannot be opened', async () => {
    const wrapper = mount(ExtensionReviewPrompt, {
      attachTo: globalThis.document.body,
      props: {
        repository: {
          claimDuePrompt: () => Promise.resolve(true),
          openStoreReview: () => Promise.reject(new Error('blocked'))
        }
      }
    });
    await flushPromises();

    actionButton('去评价').click();
    await flushPromises();

    expect(globalThis.document.body.querySelector('[role="alert"]')?.textContent).toContain(
      '未能打开 Chrome 应用商店'
    );
    expect(globalThis.document.body.textContent).toContain('用得不错？赏个评价。');
    wrapper.unmount();
  });

  it('treats dismissing the dialog as maybe later', async () => {
    const wrapper = mount(ExtensionReviewPrompt, {
      attachTo: globalThis.document.body,
      props: {
        repository: {
          claimDuePrompt: () => Promise.resolve(true),
          openStoreReview: () => Promise.resolve()
        }
      }
    });
    await flushPromises();

    actionButton('以后再说').click();
    await flushPromises();

    expect(globalThis.document.body.textContent).not.toContain('用得不错？赏个评价。');
    wrapper.unmount();
  });

  it.each([
    ['the overlay', () => globalThis.document.body.querySelector<HTMLElement>('.ov-dialog-overlay')?.click()],
    [
      'Escape',
      () =>
        globalThis.document.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
        )
    ]
  ])('treats closing with %s as maybe later', async (_label, closeDialog) => {
    const wrapper = mount(ExtensionReviewPrompt, {
      attachTo: globalThis.document.body,
      props: {
        repository: {
          claimDuePrompt: () => Promise.resolve(true),
          openStoreReview: () => Promise.resolve()
        }
      }
    });
    await flushPromises();

    closeDialog();
    await flushPromises();

    expect(globalThis.document.body.textContent).not.toContain('用得不错？赏个评价。');
    wrapper.unmount();
  });
});

function actionButtons(): HTMLButtonElement[] {
  const dialog = globalThis.document.body.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('Missing review prompt dialog');
  return [...dialog.querySelectorAll<HTMLButtonElement>('button')];
}

function actionButton(label: string): HTMLButtonElement {
  const button = actionButtons().find((candidate) => candidate.textContent.includes(label));
  if (!button) throw new Error(`Missing action: ${label}`);
  return button;
}
