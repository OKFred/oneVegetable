<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type Component
} from 'vue';
import {
  BarChart3,
  Boxes,
  Handshake,
  History,
  Home,
  Image,
  Menu,
  PlugZap,
  ShieldCheck,
  Settings,
  ShoppingCart,
  Sprout,
  Truck
} from '@lucide/vue';

import type {
  CredentialVaultRepository,
  ExtensionSocialBackendRepository,
  ExtensionAlibabaCredentialAcquisitionRepository,
  ControlClient,
  ControlSession,
  GatewayClient,
  HostPermissionsRepository,
  LocalDataRepository,
  OnboardingRepository,
  OperationAvailabilityClient,
  ProductDescriptionTemplateClient,
  ProductMutationJobClient,
  SettingsRepository
} from '@one-vegetable/core';
import type { SocialPublishingClient } from '@one-vegetable/core';
import { APP_VERSION } from '@one-vegetable/core/version';

import Button from './components/ui/Button.vue';
import { Avatar, AvatarFallback } from './components/ui/avatar';
import Sonner from './components/ui/Sonner.vue';
import Tooltip from './components/ui/Tooltip.vue';
import AuthGate from './components/AuthGate.vue';
import LanguageToggle from './components/LanguageToggle.vue';
import OnboardingDialog from './components/OnboardingDialog.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import { useUiI18n } from './i18n';
import { pageHash, parsePageHash, type PageId } from './lib/hash-router';
import type { RuntimeState } from './lib/data-source';
import { applyAppTheme, useAppPreferences } from './lib/preferences';
import { provideServices } from './lib/services';

const props = defineProps<{
  gateway: GatewayClient;
  settings: SettingsRepository;
  vault?: CredentialVaultRepository;
  alibabaCredentialAcquisition?: ExtensionAlibabaCredentialAcquisitionRepository;
  permissions?: HostPermissionsRepository;
  localData?: LocalDataRepository;
  onboarding?: OnboardingRepository;
  control?: ControlClient;
  socialPublishing?: SocialPublishingClient;
  extensionSocialBackend?: ExtensionSocialBackendRepository;
  productDescriptionTemplates?: ProductDescriptionTemplateClient;
  productMutationJobs?: ProductMutationJobClient;
  operationAvailability?: OperationAvailabilityClient;
  mode: 'mock' | 'extension' | 'bff';
}>();
const runtime = reactive<RuntimeState>({
  backendMeta: null,
  metaStatus: props.mode === 'bff' ? 'loading' : 'ready'
});
provideServices({
  gateway: props.gateway,
  settings: props.settings,
  mode: props.mode,
  runtime,
  ...(props.permissions ? { permissions: props.permissions } : {}),
  ...(props.localData ? { localData: props.localData } : {}),
  ...(props.onboarding ? { onboarding: props.onboarding } : {}),
  ...(props.vault ? { vault: props.vault } : {}),
  ...(props.alibabaCredentialAcquisition
    ? { alibabaCredentialAcquisition: props.alibabaCredentialAcquisition }
    : {}),
  ...(props.control ? { control: props.control } : {}),
  ...(props.socialPublishing ? { socialPublishing: props.socialPublishing } : {}),
  ...(props.extensionSocialBackend ? { extensionSocialBackend: props.extensionSocialBackend } : {}),
  ...(props.productDescriptionTemplates
    ? { productDescriptionTemplates: props.productDescriptionTemplates }
    : {}),
  ...(props.productMutationJobs ? { productMutationJobs: props.productMutationJobs } : {}),
  ...(props.operationAvailability ? { operationAvailability: props.operationAvailability } : {})
});

interface NavigationItem {
  id: PageId;
  labelKey: string;
  icon: Component;
}
interface FocusableButton {
  focus: () => void;
}
const baseItems: NavigationItem[] = [
  { id: 'dashboard', labelKey: 'shell.navigation.dashboard', icon: Home },
  { id: 'products', labelKey: 'shell.navigation.products', icon: Boxes },
  { id: 'photos', labelKey: 'shell.navigation.photos', icon: Image },
  { id: 'rfqs', labelKey: 'shell.navigation.rfqs', icon: Handshake },
  { id: 'orders', labelKey: 'shell.navigation.orders', icon: ShoppingCart },
  { id: 'logistics', labelKey: 'shell.navigation.logistics', icon: Truck },
  { id: 'insights', labelKey: 'shell.navigation.insights', icon: BarChart3 },
  { id: 'capabilities', labelKey: 'shell.navigation.capabilities', icon: PlugZap },
  { id: 'admin', labelKey: 'shell.navigation.admin', icon: ShieldCheck },
  { id: 'releases', labelKey: 'shell.navigation.releases', icon: History },
  { id: 'settings', labelKey: 'shell.navigation.settings', icon: Settings }
];
const { locale, t } = useUiI18n();
const session = ref<ControlSession | null>(null);
const { theme: themePreference } = useAppPreferences();
const darkTheme = ref(applyAppTheme(themePreference.value) === 'dark');
const authLoading = ref(props.mode === 'bff' && props.control !== undefined);
const items = computed(() =>
  baseItems.filter(
    (item) => item.id !== 'admin' || props.mode === 'extension' || session.value?.principal.role === 'admin'
  )
);
const page = ref<PageId>(parsePageHash(globalThis.location.hash) ?? 'dashboard');
const sidebarOpen = ref(false);
const sidebarPanel = ref<HTMLElement | null>(null);
const sidebarToggle = ref<FocusableButton | null>(null);
const workspaceReady = ref(props.mode !== 'extension' || props.onboarding === undefined);
const views: Record<PageId, Component> = {
  dashboard: defineAsyncComponent(() => import('./views/DashboardView.vue')),
  products: defineAsyncComponent(() => import('./views/ProductsView.vue')),
  photos: defineAsyncComponent(() => import('./views/PhotosView.vue')),
  rfqs: defineAsyncComponent(() => import('./views/RfqsView.vue')),
  orders: defineAsyncComponent(() => import('./views/OrdersView.vue')),
  logistics: defineAsyncComponent(() => import('./views/LogisticsView.vue')),
  insights: defineAsyncComponent(() => import('./views/InsightsView.vue')),
  capabilities: defineAsyncComponent(() => import('./views/CapabilitiesView.vue')),
  admin: defineAsyncComponent(() => import('./views/AdminView.vue')),
  releases: defineAsyncComponent(() => import('./views/ReleaseNotesView.vue')),
  settings: defineAsyncComponent(() => import('./views/SettingsView.vue'))
};
const activeView = computed(() => views[page.value]);
const colorScheme = globalThis.matchMedia('(prefers-color-scheme: dark)');
const desktopNavigationQuery = globalThis.matchMedia('(min-width: 1024px)');
const desktopNavigation = ref(desktopNavigationQuery.matches);
const identityName = computed(
  () =>
    session.value?.principal.username ??
    t(props.mode === 'extension' ? 'shell.identity.extensionAdmin' : 'shell.identity.localDemo')
);
const identityInitials = computed(() => avatarInitials(identityName.value));

watch(
  locale,
  () => {
    globalThis.document.title = t('shell.documentTitle');
  },
  { immediate: true }
);

function syncTheme(): void {
  darkTheme.value = applyAppTheme(themePreference.value) === 'dark';
}

function syncDesktopNavigation(): void {
  desktopNavigation.value = desktopNavigationQuery.matches;
}

async function openSidebar(): Promise<void> {
  sidebarOpen.value = true;
  await nextTick();
  sidebarPanel.value?.querySelector<HTMLElement>('nav a')?.focus();
}

async function closeSidebar(restoreFocus = false): Promise<void> {
  if (!sidebarOpen.value) return;
  sidebarOpen.value = false;
  if (restoreFocus) {
    await nextTick();
    sidebarToggle.value?.focus();
  }
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !sidebarOpen.value || desktopNavigation.value) return;
  event.preventDefault();
  void closeSidebar(true);
}

function isPageAllowed(nextPage: PageId): boolean {
  return nextPage !== 'admin' || props.mode === 'extension' || session.value?.principal.role === 'admin';
}

function replacePage(nextPage: PageId): void {
  page.value = nextPage;
  const nextHash = pageHash(nextPage);
  if (globalThis.location.hash !== nextHash) {
    globalThis.history.replaceState(null, '', nextHash);
  }
}

function syncPageFromHash(): void {
  if (authLoading.value) return;

  const requestedPage = parsePageHash(globalThis.location.hash);
  if (requestedPage && isPageAllowed(requestedPage)) {
    page.value = requestedPage;
  } else {
    replacePage('dashboard');
  }
  sidebarOpen.value = false;
}

function handleAuthenticated(nextSession: ControlSession): void {
  session.value = nextSession;
  syncPageFromHash();
}

function handleOnboardingReady(destination?: 'settings'): void {
  workspaceReady.value = true;
  if (destination === 'settings') replacePage('settings');
}

watch(themePreference, syncTheme);

onMounted(async () => {
  colorScheme.addEventListener('change', syncTheme);
  desktopNavigationQuery.addEventListener('change', syncDesktopNavigation);
  globalThis.addEventListener('hashchange', syncPageFromHash);
  globalThis.addEventListener('popstate', syncPageFromHash);
  globalThis.addEventListener('keydown', handleGlobalKeydown);
  if (props.mode === 'bff' && props.control) {
    void loadBackendMeta(props.control);
    try {
      session.value = await props.control.session();
    } catch {
      session.value = null;
    } finally {
      authLoading.value = false;
    }
  }
  syncPageFromHash();
});

async function loadBackendMeta(control: ControlClient): Promise<void> {
  try {
    runtime.backendMeta = await control.backendMeta();
    runtime.metaStatus = 'ready';
  } catch {
    runtime.backendMeta = null;
    runtime.metaStatus = 'error';
  }
}

onBeforeUnmount(() => {
  colorScheme.removeEventListener('change', syncTheme);
  desktopNavigationQuery.removeEventListener('change', syncDesktopNavigation);
  globalThis.removeEventListener('hashchange', syncPageFromHash);
  globalThis.removeEventListener('popstate', syncPageFromHash);
  globalThis.removeEventListener('keydown', handleGlobalKeydown);
});

async function logout(): Promise<void> {
  if (!props.control) return;
  await props.control.logout();
  session.value = null;
  replacePage('dashboard');
}

function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase();
  }
  return Array.from(words[0] ?? 'OV')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <Sonner :theme="darkTheme ? 'dark' : 'light'" />
    <div v-if="authLoading" class="grid min-h-screen place-items-center text-sm text-muted-foreground">
      {{ t('shell.checkingSession') }}
    </div>
    <div
      v-if="authLoading || (mode === 'bff' && control && !session) || !workspaceReady"
      class="fixed right-4 top-4 z-[80] flex items-center gap-1"
    >
      <LanguageToggle />
      <ThemeToggle />
    </div>
    <AuthGate
      v-if="!authLoading && mode === 'bff' && control && !session"
      @authenticated="handleAuthenticated"
    />
    <OnboardingDialog @ready="handleOnboardingReady" />
    <template v-if="!authLoading && (mode !== 'bff' || session) && workspaceReady">
      <aside
        id="app-primary-navigation"
        ref="sidebarPanel"
        class="fixed inset-y-0 left-0 z-40 w-60 border-r bg-slate-950 text-slate-100 transition-transform lg:translate-x-0"
        :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
        :aria-hidden="!sidebarOpen && !desktopNavigation ? 'true' : undefined"
        :inert="!sidebarOpen && !desktopNavigation"
      >
        <div class="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
          <span class="flex size-9 items-center justify-center rounded-lg bg-emerald-500 text-slate-950"
            ><Sprout class="size-5"
          /></span>
          <div>
            <p class="font-semibold">{{ t('shell.brand') }}</p>
            <p class="text-[10px] uppercase tracking-[0.18em] text-slate-400">
              oneVegetable {{ APP_VERSION }}
            </p>
          </div>
        </div>
        <nav
          class="h-[calc(100vh-4rem)] space-y-1 overflow-y-auto p-3"
          :aria-label="t('shell.primaryNavigation')"
        >
          <a
            v-for="item in items"
            :key="item.id"
            :href="pageHash(item.id)"
            :aria-current="page === item.id ? 'page' : undefined"
            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
            :class="
              page === item.id
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            "
            @click="sidebarOpen = false"
          >
            <component :is="item.icon" class="size-4" />{{ t(item.labelKey) }}
          </a>
        </nav>
      </aside>
      <div class="lg:pl-60">
        <header
          class="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/90 px-4 backdrop-blur lg:px-7"
        >
          <Button
            ref="sidebarToggle"
            variant="ghost"
            size="icon"
            class="lg:hidden"
            :aria-label="t('shell.openNavigation')"
            aria-controls="app-primary-navigation"
            :aria-expanded="sidebarOpen"
            @click="openSidebar"
            ><Menu class="size-5"
          /></Button>
          <p class="hidden text-sm text-muted-foreground sm:block">{{ t('shell.workspaceTitle') }}</p>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <LanguageToggle />
            <ThemeToggle />
            <Tooltip :text="identityName">
              <Avatar
                class="border border-border bg-card text-foreground shadow-sm"
                role="img"
                data-testid="account-avatar"
                :aria-label="t('shell.identity.avatarLabel', { name: identityName })"
              >
                <AvatarFallback class="bg-primary text-xs text-primary-foreground">
                  {{ identityInitials }}
                </AvatarFallback>
              </Avatar>
            </Tooltip>
            <Button v-if="mode === 'bff' && session" variant="outline" size="sm" @click="logout">
              {{ t('shell.logout') }}
            </Button>
          </div>
        </header>
        <main class="p-4 lg:p-7"><component :is="activeView" /></main>
      </div>
      <Transition name="ov-fade">
        <button
          v-if="sidebarOpen"
          class="fixed inset-0 z-30 bg-black/40 lg:hidden"
          :aria-label="t('shell.closeNavigation')"
          @click="closeSidebar(true)"
        />
      </Transition>
    </template>
  </div>
</template>
