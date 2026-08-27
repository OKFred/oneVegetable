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
  Home,
  Image,
  Menu,
  Moon,
  PlugZap,
  ShieldCheck,
  Settings,
  ShoppingCart,
  Sprout,
  Sun,
  Truck
} from '@lucide/vue';

import type {
  CredentialVaultRepository,
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
import { APP_VERSION } from '@one-vegetable/core/version';

import Button from './components/ui/Button.vue';
import AuthGate from './components/AuthGate.vue';
import OnboardingDialog from './components/OnboardingDialog.vue';
import { pageHash, parsePageHash, type PageId } from './lib/hash-router';
import { resolveDataSource, type RuntimeState } from './lib/data-source';
import { applyAppTheme, useAppPreferences } from './lib/preferences';
import { provideServices } from './lib/services';

const props = defineProps<{
  gateway: GatewayClient;
  settings: SettingsRepository;
  vault?: CredentialVaultRepository;
  permissions?: HostPermissionsRepository;
  localData?: LocalDataRepository;
  onboarding?: OnboardingRepository;
  control?: ControlClient;
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
  ...(props.control ? { control: props.control } : {}),
  ...(props.productDescriptionTemplates
    ? { productDescriptionTemplates: props.productDescriptionTemplates }
    : {}),
  ...(props.productMutationJobs ? { productMutationJobs: props.productMutationJobs } : {}),
  ...(props.operationAvailability ? { operationAvailability: props.operationAvailability } : {})
});

interface NavigationItem {
  id: PageId;
  label: string;
  icon: Component;
}
interface FocusableButton {
  focus: () => void;
}
const baseItems: NavigationItem[] = [
  { id: 'dashboard', label: '总览', icon: Home },
  { id: 'products', label: '商品', icon: Boxes },
  { id: 'photos', label: '图库', icon: Image },
  { id: 'rfqs', label: 'RFQ', icon: Handshake },
  { id: 'orders', label: '订单', icon: ShoppingCart },
  { id: 'logistics', label: '国际物流', icon: Truck },
  { id: 'insights', label: '数据洞察', icon: BarChart3 },
  { id: 'capabilities', label: 'API 能力', icon: PlugZap },
  { id: 'admin', label: '管理后台', icon: ShieldCheck },
  { id: 'settings', label: '设置', icon: Settings }
];
const session = ref<ControlSession | null>(null);
const dataSource = computed(() => resolveDataSource(props.mode, runtime));
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
  settings: defineAsyncComponent(() => import('./views/SettingsView.vue'))
};
const activeView = computed(() => views[page.value]);
const colorScheme = globalThis.matchMedia('(prefers-color-scheme: dark)');
const desktopNavigationQuery = globalThis.matchMedia('(min-width: 1024px)');
const desktopNavigation = ref(desktopNavigationQuery.matches);

function syncTheme(): void {
  darkTheme.value = applyAppTheme(themePreference.value) === 'dark';
}

function toggleTheme(): void {
  themePreference.value = darkTheme.value ? 'light' : 'dark';
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
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div v-if="authLoading" class="grid min-h-screen place-items-center text-sm text-muted-foreground">
      正在检查本地会话…
    </div>
    <AuthGate v-else-if="mode === 'bff' && control && !session" @authenticated="handleAuthenticated" />
    <OnboardingDialog @ready="workspaceReady = true" />
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
            <p class="font-semibold">一根青菜</p>
            <p class="text-[10px] uppercase tracking-[0.18em] text-slate-400">
              oneVegetable {{ APP_VERSION }}
            </p>
          </div>
        </div>
        <nav class="space-y-1 p-3" aria-label="主导航">
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
            <component :is="item.icon" class="size-4" />{{ item.label }}
          </a>
        </nav>
        <div class="absolute inset-x-3 bottom-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
          <p class="text-xs font-medium">
            {{ dataSource.label }}
          </p>
          <p class="mt-1 text-[11px] leading-4 text-slate-400">
            {{ dataSource.description }}
          </p>
        </div>
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
            aria-label="打开主导航"
            aria-controls="app-primary-navigation"
            :aria-expanded="sidebarOpen"
            @click="openSidebar"
            ><Menu class="size-5"
          /></Button>
          <p class="hidden text-sm text-muted-foreground sm:block">国际站开放平台运营工作台</p>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <Button
              variant="ghost"
              size="icon"
              :aria-label="darkTheme ? '切换到浅色模式' : '切换到夜间模式'"
              :title="darkTheme ? '切换到浅色模式' : '切换到夜间模式'"
              @click="toggleTheme"
            >
              <Sun v-if="darkTheme" class="size-4" />
              <Moon v-else class="size-4" />
            </Button>
            <span class="size-2 rounded-full" :class="dataSource.dotClass" />{{ dataSource.label }}
            <span v-if="session">{{ session.principal.username }}</span>
            <Button v-if="mode === 'bff' && session" variant="outline" size="sm" @click="logout">
              退出
            </Button>
          </div>
        </header>
        <main class="p-4 lg:p-7"><component :is="activeView" /></main>
      </div>
      <Transition name="ov-fade">
        <button
          v-if="sidebarOpen"
          class="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-label="关闭导航"
          @click="closeSidebar(true)"
        />
      </Transition>
    </template>
  </div>
</template>
