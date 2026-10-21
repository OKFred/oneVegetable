import { effectScope, ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { useDialogLayer } from '../src/composables/use-dialog-layer';

const scopes: ReturnType<typeof effectScope>[] = [];
function layer(initial = false) {
  const open = ref(initial);
  const scope = effectScope();
  scopes.push(scope);
  const value = scope.run(() => useDialogLayer(() => open.value));
  if (!value) throw new Error('Missing layer scope');
  return {
    ...value,
    open,
    dispose: () => {
      scope.stop();
    }
  };
}
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
});

describe('dialog activation layers', () => {
  it('follows opening order rather than component or portal creation order', () => {
    const confirmation = layer();
    const configuration = layer(true);
    expect(configuration.isTopmost.value).toBe(true);
    confirmation.open.value = true;
    expect(confirmation.isTopmost.value).toBe(true);
    expect(configuration.isTopmost.value).toBe(false);
    expect(confirmation.overlayStyle.value.zIndex).toBeGreaterThan(configuration.contentStyle.value.zIndex);
    const event = new Event('dismiss', { cancelable: true });
    configuration.preventBackgroundDismiss(event);
    expect(event.defaultPrevented).toBe(true);
    const topEvent = new Event('dismiss', { cancelable: true });
    confirmation.preventBackgroundDismiss(topEvent);
    expect(topEvent.defaultPrevented).toBe(false);
  });

  it('keeps three levels ordered and restores the previous layer after closing the top', () => {
    const confirm = layer();
    const editor = layer();
    const configuration = layer(true);
    editor.open.value = true;
    confirm.open.value = true;
    expect(editor.overlayStyle.value.zIndex).toBeGreaterThan(configuration.contentStyle.value.zIndex);
    expect(confirm.overlayStyle.value.zIndex).toBeGreaterThan(editor.contentStyle.value.zIndex);
    const closingIndex = confirm.contentStyle.value.zIndex;
    confirm.open.value = false;
    expect(editor.isTopmost.value).toBe(true);
    expect(configuration.isTopmost.value).toBe(false);
    expect(confirm.contentStyle.value.zIndex).toBe(closingIndex);
    editor.open.value = false;
    expect(configuration.isTopmost.value).toBe(true);
  });

  it('reorders reopened dialogs without accumulating layers and releases unmounted ones', () => {
    const a = layer(true);
    const b = layer(true);
    b.dispose();
    expect(a.isTopmost.value).toBe(true);
    for (let count = 0; count < 50; count++) {
      const next = layer(true);
      expect(next.contentStyle.value.zIndex).toBe(63);
      next.open.value = false;
      expect(a.isTopmost.value).toBe(true);
      next.open.value = true;
      expect(next.isTopmost.value).toBe(true);
      next.dispose();
    }
    expect(a.contentStyle.value.zIndex).toBe(61);
  });

  it('covers every Reka dialog primitive and leaves no legacy fixed dialog mask', async () => {
    const directory = resolve(import.meta.dirname, '../src/components');
    const files = await readdir(directory, { recursive: true });
    const primitives: string[] = [];
    for (const file of files.filter((name) => name.endsWith('.vue'))) {
      const source = await readFile(resolve(directory, file), 'utf8');
      if (!source.includes('<DialogContent')) continue;
      primitives.push(file);
      expect(source, file).toContain('useDialogLayer');
      expect(source, file).toContain(':style="overlayStyle"');
      expect(source, file).toContain(':style="contentStyle"');
      expect(source, file).not.toMatch(/\bz-(?:\[\d+\]|50)\b/u);
    }
    expect(primitives).toHaveLength(6);
    // The first-run guide uses the same stack and Reka's focus/scroll guards.
    expect(primitives).toContain('OnboardingDialog.vue');
    expect(primitives).toContain('PhotoBankPicker.vue');
  });
});
