import { inject, provide, type InjectionKey } from 'vue';

import type {
  CredentialVaultRepository,
  ControlClient,
  GatewayClient,
  HostPermissionsRepository,
  LocalDataRepository,
  OnboardingRepository,
  OperationAvailabilityClient,
  ProductDescriptionTemplateClient,
  ProductMutationJobClient,
  SettingsRepository
} from '@one-vegetable/core';

export interface AppServices {
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
