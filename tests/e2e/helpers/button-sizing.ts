import { expect, type Locator } from '@playwright/test';

/** Check rendered geometry, not class names: covers slotted, link and file actions too. */
export async function expectDefaultActionSizing(group: Locator): Promise<void> {
  await expect(group).toBeVisible();
  const sizes = await group.locator('button, a, label:has(input[type="file"])').evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const groupRect = element.closest('section')?.getBoundingClientRect();
        return {
          text: element.textContent.trim(),
          height: rect.height,
          font: parseFloat(style.fontSize),
          withinGroup: !groupRect || (rect.left >= groupRect.left - 1 && rect.right <= groupRect.right + 1),
          icons: [...element.querySelectorAll('svg')].map((icon) => {
            const bounds = icon.getBoundingClientRect();
            return { width: bounds.width, height: bounds.height, shrink: getComputedStyle(icon).flexShrink };
          })
        };
      })
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) {
    expect(size.height, size.text).toBeCloseTo(36, 0);
    expect(size.font, size.text).toBe(14);
    expect(size.withinGroup, size.text).toBe(true);
    for (const icon of size.icons) {
      expect(icon.width, size.text).toBeCloseTo(16, 0);
      expect(icon.height, size.text).toBeCloseTo(16, 0);
      expect(icon.shrink, size.text).toBe('0');
    }
  }
}
