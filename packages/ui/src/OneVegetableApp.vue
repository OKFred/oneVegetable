<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import {
  Boxes,
  Handshake,
  Home,
  Image,
  Menu,
  PlugZap,
  Settings,
  ShoppingCart,
  Sprout,
  Truck
} from '@lucide/vue';

import type { GatewayClient, SettingsRepository } from '@one-vegetable/core';

import DashboardView from './views/DashboardView.vue';
import ProductsView from './views/ProductsView.vue';
import PhotosView from './views/PhotosView.vue';
import OrdersView from './views/OrdersView.vue';
import CapabilitiesView from './views/CapabilitiesView.vue';
import SettingsView from './views/SettingsView.vue';
import RfqsView from './views/RfqsView.vue';
import LogisticsView from './views/LogisticsView.vue';
import Button from './components/ui/Button.vue';
import { provideServices } from './lib/services';

const props = defineProps<{
  gateway: GatewayClient;
  settings: SettingsRepository;
  mode: 'mock' | 'extension';
}>();
provideServices(props);

type PageId =
  'dashboard' | 'products' | 'photos' | 'rfqs' | 'orders' | 'logistics' | 'capabilities' | 'settings';
interface NavigationItem {
  id: PageId;
  label: string;
  icon: Component;
}
const items: NavigationItem[] = [
  { id: 'dashboard', label: '总览', icon: Home },
  { id: 'products', label: '商品', icon: Boxes },
  { id: 'photos', label: '图库', icon: Image },
  { id: 'rfqs', label: 'RFQ', icon: Handshake },
  { id: 'orders', label: '订单', icon: ShoppingCart },
  { id: 'logistics', label: '国际物流', icon: Truck },
  { id: 'capabilities', label: 'API 能力', icon: PlugZap },
  { id: 'settings', label: '设置', icon: Settings }
];
const page = ref<PageId>('dashboard');
const sidebarOpen = ref(false);
const views: Record<PageId, Component> = {
  dashboard: DashboardView,
  products: ProductsView,
  photos: PhotosView,
  rfqs: RfqsView,
  orders: OrdersView,
  logistics: LogisticsView,
  capabilities: CapabilitiesView,
  settings: SettingsView
};
const activeView = computed(() => views[page.value]);
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <aside
      class="fixed inset-y-0 left-0 z-40 w-60 border-r bg-slate-950 text-slate-100 transition-transform lg:translate-x-0"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
        <span class="flex size-9 items-center justify-center rounded-lg bg-emerald-500 text-slate-950"
          ><Sprout class="size-5"
        /></span>
        <div>
          <p class="font-semibold">一根青菜</p>
          <p class="text-[10px] uppercase tracking-[0.18em] text-slate-400">oneVegetable 2.0</p>
        </div>
      </div>
      <nav class="space-y-1 p-3">
        <button
          v-for="item in items"
          :key="item.id"
          class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
          :class="
            page === item.id
              ? 'bg-emerald-500 text-slate-950'
              : 'text-slate-300 hover:bg-slate-900 hover:text-white'
          "
          @click="
            page = item.id;
            sidebarOpen = false;
          "
        >
          <component :is="item.icon" class="size-4" />{{ item.label }}
        </button>
      </nav>
      <div class="absolute inset-x-3 bottom-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
        <p class="text-xs font-medium">{{ mode === 'mock' ? 'Mock 模式' : 'Extension MV3' }}</p>
        <p class="mt-1 text-[11px] leading-4 text-slate-400">
          {{ mode === 'mock' ? '不发送真实 API 请求' : '请求由 service worker 签名' }}
        </p>
      </div>
    </aside>
    <div class="lg:pl-60">
      <header
        class="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/90 px-4 backdrop-blur lg:px-7"
      >
        <Button variant="ghost" size="icon" class="lg:hidden" @click="sidebarOpen = true"
          ><Menu class="size-5"
        /></Button>
        <p class="hidden text-sm text-muted-foreground sm:block">国际站开放平台运营工作台</p>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span class="size-2 rounded-full bg-emerald-500" />{{
            mode === 'mock' ? '契约 Mock 在线' : '扩展后台在线'
          }}
        </div>
      </header>
      <main class="p-4 lg:p-7"><component :is="activeView" /></main>
    </div>
    <button
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-black/40 lg:hidden"
      aria-label="关闭导航"
      @click="sidebarOpen = false"
    />
  </div>
</template>
