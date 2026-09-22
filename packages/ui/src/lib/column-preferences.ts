import { computed, ref, type Ref } from 'vue';

export const COLUMN_PREFERENCES_PREFIX = 'one-vegetable:columns:v2:';
export const LEGACY_COLUMN_PREFERENCES_PREFIX = 'one-vegetable:columns:v1:';
export interface ColumnOption {
  id: string;
  label: string;
  locked: boolean;
  defaultVisible: boolean;
}

export interface ColumnPreferenceV2 {
  version: 2;
  visible: string[];
  order: string[];
}

function stringIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id: unknown) => typeof id === 'string' && id.length > 0);
}

export function parseColumnPreference(value: string | null): ColumnPreferenceV2 | null {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      !('visible' in parsed) ||
      !stringIds(parsed.visible)
    )
      return null;
    const visible = [...new Set(parsed.visible)];
    if (parsed.version === 1) return { version: 2, visible, order: [] };
    if (parsed.version !== 2 || !('order' in parsed) || !stringIds(parsed.order)) return null;
    return { version: 2, visible, order: [...new Set(parsed.order)] };
  } catch {
    return null;
  }
}

export function normalizeColumnPreference(
  value: ColumnPreferenceV2 | null,
  options: ColumnOption[]
): ColumnPreferenceV2 {
  const ids = options.map((option) => option.id);
  const ordered = [...new Set([...(value?.order ?? []), ...ids])].filter((id) => ids.includes(id));
  const order = [
    ...ordered.filter((id) => id === 'select'),
    ...ordered.filter((id) => id !== 'select' && id !== 'actions'),
    ...ordered.filter((id) => id === 'actions')
  ];
  const visible = order.filter((id) => {
    const option = options.find((entry) => entry.id === id);
    if (option?.locked) return true;
    return value === null ? option?.defaultVisible : value.visible.includes(id);
  });
  return { version: 2, visible, order };
}

export function useColumnPreferences(key: string, options: Ref<ColumnOption[]>) {
  let initial: ColumnPreferenceV2 | null = null;
  let legacy = false;
  if (key)
    try {
      const stored = localStorage.getItem(COLUMN_PREFERENCES_PREFIX + key);
      initial = parseColumnPreference(stored);
      if (stored === null) {
        initial = parseColumnPreference(localStorage.getItem(LEGACY_COLUMN_PREFERENCES_PREFIX + key));
        legacy = initial !== null;
      }
    } catch {
      /* unavailable storage */
    }
  const selected = ref<ColumnPreferenceV2 | null>(initial);
  const persistenceFailed = ref(false);
  const normalized = computed(() => normalizeColumnPreference(selected.value, options.value));
  const visible = computed(() => normalized.value.visible);
  const order = computed(() => normalized.value.order);
  const orderedOptions = computed(() =>
    order.value.flatMap((id) => options.value.filter((option) => option.id === id))
  );
  function save(value: ColumnPreferenceV2 | null): void {
    selected.value = value === null ? null : normalizeColumnPreference(value, options.value);
    if (!key) return;
    try {
      if (value === null) localStorage.removeItem(COLUMN_PREFERENCES_PREFIX + key);
      else localStorage.setItem(COLUMN_PREFERENCES_PREFIX + key, JSON.stringify(selected.value));
      localStorage.removeItem(LEGACY_COLUMN_PREFERENCES_PREFIX + key);
      persistenceFailed.value = false;
    } catch {
      persistenceFailed.value = true;
    }
  }
  if (legacy) save(initial);
  function move(id: string, target: string): void {
    if (
      id === target ||
      options.value.find((option) => option.id === id)?.locked ||
      options.value.find((option) => option.id === target)?.locked
    )
      return;
    const from = order.value.indexOf(id);
    const to = order.value.indexOf(target);
    if (from < 0 || to < 0) return;
    const next = [...order.value];
    next.splice(from, 1);
    next.splice(to, 0, id);
    save({ ...normalized.value, order: next });
  }
  return {
    visible,
    order,
    orderedOptions,
    persistenceFailed,
    toggle: (id: string) => {
      if (!options.value.some((option) => option.id === id && !option.locked)) return;
      save({
        ...normalized.value,
        visible: visible.value.includes(id)
          ? visible.value.filter((value) => value !== id)
          : [...visible.value, id]
      });
    },
    setAll: (checked: boolean) => {
      save({
        ...normalized.value,
        visible: options.value.filter((option) => option.locked || checked).map((option) => option.id)
      });
    },
    move,
    moveBy: (id: string, delta: number) => {
      const movable = orderedOptions.value.filter((option) => !option.locked);
      const target = movable[movable.findIndex((option) => option.id === id) + delta];
      if (target) move(id, target.id);
    },
    reset: () => {
      save(null);
    }
  };
}

export function clearColumnPreferences(): void {
  for (const key of Object.keys(localStorage))
    if (key.startsWith(COLUMN_PREFERENCES_PREFIX) || key.startsWith(LEGACY_COLUMN_PREFERENCES_PREFIX))
      localStorage.removeItem(key);
}
