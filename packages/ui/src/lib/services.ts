import { inject, provide, type InjectionKey } from 'vue';

import type { GatewayClient, HostPermissionsRepository, SettingsRepository } from '@one-vegetable/core';

export interface AppServices {
  gateway: GatewayClient;
  settings: SettingsRepository;
  permissions?: HostPermissionsRepository;
  mode: 'mock' | 'extension';
}

const servicesKey: InjectionKey<AppServices> = Symbol('one-vegetable-services');

export function provideServices(services: AppServices): void {
  provide(servicesKey, services);
}

export function useServices(): AppServices {
  const services = inject(servicesKey);
  if (!services) throw new Error('oneVegetable services were not provided');
  return services;
}
