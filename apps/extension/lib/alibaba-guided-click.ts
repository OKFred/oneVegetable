import { browser } from 'wxt/browser';

export type AlibabaGuidedTarget = 'application-center' | 'reveal-secret';

/** Only these read-only controls can be animated/clicked; never OAuth approval or Reset. */
export async function clickAlibabaGuidedTarget(
  tabId: number,
  action: AlibabaGuidedTarget,
  frameId?: number,
  expectedAppKey?: string,
  expiresAtUtc?: number
): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] },
    world: 'ISOLATED',
    func: clickAlibabaGuidedTargetInFrame,
    args: [action, expectedAppKey ?? '', expiresAtUtc ?? 0]
  });
  return results.some((result) => result.result === true);
}

/** Self-contained because Chrome serializes this function into the permitted frame. */
export async function clickAlibabaGuidedTargetInFrame(
  action: AlibabaGuidedTarget,
  expectedAppKey?: string,
  expiresAtUtc = 0
): Promise<boolean> {
  if (expectedAppKey) {
    const keyField = [...document.querySelectorAll('.cloud-form')].find(
      (form) => form.querySelector('.form-label')?.textContent.trim() === 'AppKey'
    );
    if (keyField?.querySelector('.form-item')?.textContent.trim() !== expectedAppKey) return false;
  }
  const visible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const scope =
    action === 'reveal-secret'
      ? [...document.querySelectorAll('.cloud-form')].find((form) =>
          /^(App\s*Secret|应用密钥)\s*[:：]?$/iu.test(
            form.querySelector('.form-label')?.textContent.trim() ?? ''
          )
        )
      : document;
  if (!scope) return false;
  const pattern =
    action === 'application-center' ? /^(application\s*cent(?:er|re)|应用中心)$/iu : /^(view|查看)$/iu;
  // The API configuration dialog uses plain UL > LI navigation, not ARIA tabs.
  const controls = 'button, a, [role="button"], [role="tab"]';
  const selector = action === 'application-center' ? `${controls}, ul > li` : controls;
  const target = [...scope.querySelectorAll(selector)].find(
    (element) => visible(element) && pattern.test(element.textContent.trim())
  );
  if (!(target instanceof HTMLElement) || target.matches(':disabled, [aria-disabled="true"]')) return false;
  // A list-item wrapper must not bypass an anchor's destination or a button's disabled state.
  if (target.matches('li') && (target.closest(controls) || target.querySelector(controls))) return false;
  const originalHref = target instanceof HTMLAnchorElement ? target.href : null;
  const inertSecretLink =
    action === 'reveal-secret' &&
    !!expectedAppKey &&
    target instanceof HTMLAnchorElement &&
    /^javascript:void\(0\);?$/u.test(target.getAttribute('href') ?? '');
  // Never disguise a link to a different/retired platform as an application-center click.
  // The provider's View link is an exact no-op href. Match it as text, never evaluate it.
  if (target instanceof HTMLAnchorElement && target.href && !inertSecretLink) {
    const destination = new URL(target.href, location.href);
    if (
      destination.protocol !== 'https:' ||
      !['i.alibaba.com', 'openapi.alibaba.com'].includes(destination.hostname)
    )
      return false;
  }
  if (document.querySelector('[data-one-vegetable-guided-pointer]')) return false;
  const host = document.createElement('div');
  host.dataset.oneVegetableGuidedPointer = '';
  host.setAttribute('data-feedback-ignore', '');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'closed' });
  const outline = document.createElement('div');
  outline.style.cssText =
    'position:fixed;border:2px solid #2563eb;border-radius:6px;box-shadow:0 0 0 4px #2563eb25;box-sizing:border-box;pointer-events:none';
  const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cursor.setAttribute('viewBox', '0 0 28 32');
  cursor.setAttribute('width', '28');
  cursor.setAttribute('height', '32');
  cursor.style.cssText =
    'position:fixed;left:0;top:0;filter:drop-shadow(0 2px 3px #0006);pointer-events:none';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 2L3 25L9 19L14 29L19 26L14 17L24 17Z');
  path.setAttribute('fill', '#2563eb');
  path.setAttribute('stroke', 'white');
  path.setAttribute('stroke-width', '2');
  cursor.append(path);
  shadow.append(outline, cursor);
  document.documentElement.append(host);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
  const guide = document.getElementById('one-vegetable-alibaba-developer-guide');
  const guidePointerEvents = guide?.style.pointerEvents ?? '';
  try {
    // Our own guide must not cover the clicked control. Other dialogs/overlays
    // still block the hit test; only this extension-owned panel is excluded.
    if (guide) guide.style.pointerEvents = 'none';
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await wait(30);
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    outline.style.left = `${rect.left - 3}px`;
    outline.style.top = `${rect.top - 3}px`;
    outline.style.width = `${rect.width + 6}px`;
    outline.style.height = `${rect.height + 6}px`;
    if (!reduced && typeof cursor.animate === 'function') {
      await cursor.animate(
        [
          {
            transform: `translate(${Math.min(innerWidth - 32, x + 100)}px, ${Math.min(innerHeight - 36, y + 80)}px)`
          },
          { transform: `translate(${x}px, ${y}px)` }
        ],
        { duration: 420, easing: 'ease-out', fill: 'forwards' }
      ).finished;
    }
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    await wait(reduced ? 0 : 160);
    if (!target.isConnected || !visible(target) || target.matches(':disabled, [aria-disabled="true"]'))
      return false;
    if (
      (expiresAtUtc > 0 && Date.now() >= expiresAtUtc) ||
      !pattern.test(target.textContent.trim()) ||
      !scope.contains(target) ||
      (action === 'reveal-secret' &&
        scope instanceof Element &&
        !/^(App\s*Secret|应用密钥)\s*[:：]?$/iu.test(
          scope.querySelector('.form-label')?.textContent.trim() ?? ''
        )) ||
      (target.matches('li') &&
        (!target.matches('ul > li') || !!target.closest(controls) || !!target.querySelector(controls)))
    )
      return false;
    if (target instanceof HTMLAnchorElement && target.href !== originalHref) return false;
    if (expectedAppKey) {
      const keyField = [...document.querySelectorAll('.cloud-form')].find(
        (form) => form.querySelector('.form-label')?.textContent.trim() === 'AppKey'
      );
      if (keyField?.querySelector('.form-item')?.textContent.trim() !== expectedAppKey) return false;
    }
    // Stop if a dialog/overlay appeared while the pointer was moving.
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== target && !target.contains(hit))) return false;
    target.click();
    await wait(reduced ? 0 : 220);
    return true;
  } finally {
    if (guide) guide.style.pointerEvents = guidePointerEvents;
    host.remove();
  }
}
