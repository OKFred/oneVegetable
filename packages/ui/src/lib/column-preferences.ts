import { computed, ref, type Ref } from 'vue';

export const COLUMN_PREFERENCES_PREFIX = 'one-vegetable:columns:v1:';
export interface ColumnOption {
  id: string;
  label: string;
  locked: boolean;
  defaultVisible: boolean;
}

export function parseColumnPreference(value: string | null): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('visible' in parsed) ||
      !Array.isArray(parsed.visible) ||
      !parsed.visible.every((id: unknown) => typeof id === 'string')
    )
      return null;
    return [...new Set(parsed.visible)];
  } catch {
    return null;
  }
}

export function useColumnPreferences(key: string, options: Ref<ColumnOption[]>) {
  let initial: string[] | null = null;
  try {
    initial = parseColumnPreference(localStorage.getItem(COLUMN_PREFERENCES_PREFIX + key));
  } catch {
    /* unavailable storage */
  }
  const selected = ref<string[] | null>(initial);
  const visible = computed(() =>
    options.value
      .filter(
        (option) =>
          option.locked ||
          (selected.value === null ? option.defaultVisible : selected.value.includes(option.id))
      )
      .map((option) => option.id)
  );
  function save(ids: string[] | null): void {
    selected.value = ids;
    try {
      if (ids === null) localStorage.removeItem(COLUMN_PREFERENCES_PREFIX + key);
      else
        localStorage.setItem(
          COLUMN_PREFERENCES_PREFIX + key,
          JSON.stringify({ version: 1, visible: visible.value })
        );
    } catch {
      /* keep the current page usable without persistence */
    }
  }
  return {
    visible,
    toggle: (id: string) => {
      save(
        visible.value.includes(id) ? visible.value.filter((value) => value !== id) : [...visible.value, id]
      );
    },
    reset: () => {
      save(null);
    }
  };
}

export function clearColumnPreferences(): void {
  for (const key of Object.keys(localStorage))
    if (key.startsWith(COLUMN_PREFERENCES_PREFIX)) localStorage.removeItem(key);
}
