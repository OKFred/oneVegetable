import { inject, provide, type InjectionKey } from 'vue';

import type {
  BackendMeta,
  CredentialVaultRepository,
  ExtensionAlibabaCredentialAcquisitionRepository,
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

import type { RuntimeMetaStatus } from './data-source';

export interface AppRuntimeState {
  backendMeta: BackendMeta | null;
  metaStatus: RuntimeMetaStatus;
}

export interface AppServices {
  gateway: GatewayClient;
  settings: SettingsRepository;
  vault?: CredentialVaultRepository;
  alibabaCredentialAcquisition?: ExtensionAlibabaCredentialAcquisitionRepository;
  permissions?: HostPermissionsRepository;
  localData?: LocalDataRepository;
  onboarding?: OnboardingRepository;
  control?: ControlClient;
  productDescriptionTemplates?: ProductDescriptionTemplateClient;
  productMutationJobs?: ProductMutationJobClient;
  operationAvailability?: OperationAvailabilityClient;
  runtime?: AppRuntimeState;
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
