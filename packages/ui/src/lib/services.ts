import { inject, provide, type InjectionKey } from 'vue';

import type {
  CredentialVaultRepository,
  GatewayClient,
  HostPermissionsRepository,
  LocalDataRepository,
  OnboardingRepository,
  SettingsRepository
} from '@one-vegetable/core';

export interface AppServices {
  gateway: GatewayClient;
  settings: SettingsRepository;
  vault?: CredentialVaultRepository;
  permissions?: HostPermissionsRepository;
  localData?: LocalDataRepository;
  onboarding?: OnboardingRepository;
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
