import {
  computed,
  inject,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
  type Ref
} from 'vue';

interface EditingRegistration {
  dirty: Readonly<Ref<boolean>>;
  markClean(): void;
}

/** In-memory only. Neither snapshots nor confirmations are persisted or logged. */
export class UnsavedEditingService {
  readonly confirmationOpen = ref(false);
  private readonly registrations = shallowRef<EditingRegistration[]>([]);
  readonly dirty = computed(() => this.registrations.value.some((entry) => entry.dirty.value));
  private pending: { entries: EditingRegistration[]; resolve: (discard: boolean) => void } | null = null;

  register(entry: EditingRegistration): () => void {
    this.registrations.value = [...this.registrations.value, entry];
    return () => {
      if (this.pending?.entries.includes(entry)) this.answer(false);
      this.registrations.value = this.registrations.value.filter((value) => value !== entry);
    };
  }

  confirmLeave(entry?: EditingRegistration): Promise<boolean> {
    if (this.pending) return Promise.resolve(false);
    if (entry ? !entry.dirty.value : !this.dirty.value) return Promise.resolve(true);
    const entries = entry ? [entry] : this.registrations.value;
    this.confirmationOpen.value = true;
    return new Promise<boolean>((resolve) => {
      this.pending = { entries, resolve };
    });
  }

  answer(discard: boolean): void {
    const pending = this.pending;
    this.pending = null;
    this.confirmationOpen.value = false;
    if (discard)
      pending?.entries.forEach((entry) => {
        entry.markClean();
      });
    pending?.resolve(discard);
  }

  dispose(): void {
    this.answer(false);
    this.registrations.value = [];
  }
}

const editingKey: InjectionKey<UnsavedEditingService> = Symbol('unsaved-editing');
export const VAULT_UNLOCKED_EVENT = 'one-vegetable:vault-unlocked';
export function provideUnsavedEditing(service: UnsavedEditingService): void {
  provide(editingKey, service);
}

/** Register business values only: exclude filters, steps, theme and UI language. */
export function useUnsavedEditing(source: () => unknown, options: { enabled?: () => boolean } = {}) {
  const service = inject(editingKey, null);
  const snapshot = computed(() => JSON.stringify(source()));
  const baseline = ref(snapshot.value);
  const dirty = computed(() => (options.enabled?.() ?? true) && snapshot.value !== baseline.value);
  function markClean(): void {
    baseline.value = snapshot.value;
  }
  const entry: EditingRegistration = { dirty, markClean };
  const unregister = service?.register(entry);
  onScopeDispose(() => unregister?.());
  async function confirmLeave(): Promise<boolean> {
    return service ? service.confirmLeave(entry) : true;
  }
  async function guard(action: () => void | Promise<void>): Promise<boolean> {
    if (!(await confirmLeave())) return false;
    await action();
    return true;
  }
  return { dirty, markClean, confirmLeave, guard };
}

/** Install before child hash listeners: cancelled navigation must not reach editors. */
export function installEditingNavigationGuard(
  service: UnsavedEditingService,
  target: Window = window
): () => void {
  let acceptedHash = target.location.hash;
  let checking = false;
  let disposed = false;
  // Keep original identities for restoration; invoke only with History as the receiver.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalPush = target.history.pushState;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalReplace = target.history.replaceState;
  const push: History['pushState'] = function (data: unknown, unused: string, url?: string | URL | null) {
    originalPush.call(target.history, data, unused, url);
    if (!checking) acceptedHash = target.location.hash;
  };
  const replace: History['replaceState'] = function (
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    originalReplace.call(target.history, data, unused, url);
    if (!checking) acceptedHash = target.location.hash;
  };
  target.history.pushState = push;
  target.history.replaceState = replace;
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!service.dirty.value) return;
    event.preventDefault();
  };
  const unwatch = watch(
    service.dirty,
    (dirty) => {
      target.removeEventListener('beforeunload', beforeUnload);
      if (dirty) target.addEventListener('beforeunload', beforeUnload);
    },
    { immediate: true, flush: 'sync' }
  );
  const hashChanged = (event: Event) => {
    const requestedHash = target.location.hash;
    // Browsers can deliver popstate followed by hashchange for the same navigation.
    // Suppress both while the modal owns the pending transition.
    if (checking) {
      event.stopImmediatePropagation();
      originalReplace.call(target.history, target.history.state, '', acceptedHash || '#/dashboard');
      return;
    }
    if (requestedHash === acceptedHash) return;
    if (!service.dirty.value) {
      acceptedHash = requestedHash;
      return;
    }
    event.stopImmediatePropagation();
    originalReplace.call(target.history, target.history.state, '', acceptedHash || '#/dashboard');
    checking = true;
    void service.confirmLeave().then((leave) => {
      checking = false;
      if (!leave || disposed) return;
      acceptedHash = requestedHash;
      target.history.replaceState(target.history.state, '', requestedHash);
      target.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  };
  target.addEventListener('hashchange', hashChanged, true);
  target.addEventListener('popstate', hashChanged, true);
  return () => {
    disposed = true;
    unwatch();
    target.removeEventListener('beforeunload', beforeUnload);
    target.removeEventListener('hashchange', hashChanged, true);
    target.removeEventListener('popstate', hashChanged, true);
    if (target.history.pushState === push) target.history.pushState = originalPush;
    if (target.history.replaceState === replace) target.history.replaceState = originalReplace;
  };
}
