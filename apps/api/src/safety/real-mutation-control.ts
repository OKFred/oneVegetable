import { EntityVersionConflictError } from '../db/repository';

import type { AppMetadata, AppMetadataRepository } from '../db/repository';
import type { EmergencyPauseFeatureFlags } from '../abac';

const METADATA_KEY = 'real_mutations_paused';

export interface RealMutationControlStatus {
  paused: boolean;
  revision: number | null;
  updateTimeUtc: number | null;
  updaterId: string | null;
  remark: string | null;
}

export class RealMutationControlService {
  constructor(
    private readonly repository: AppMetadataRepository,
    private readonly featureFlags: EmergencyPauseFeatureFlags
  ) {}

  async status(): Promise<RealMutationControlStatus> {
    return toStatus(await this.repository.get(METADATA_KEY));
  }

  async set(input: {
    paused: boolean;
    expectedRevision: number | null;
    actorId: string;
    remark: string | null;
  }): Promise<RealMutationControlStatus> {
    const current = await this.repository.get(METADATA_KEY);
    let updated: AppMetadata;
    if (!current) {
      if (input.expectedRevision !== null) throw new EntityVersionConflictError();
      updated = await this.repository.create({
        key: METADATA_KEY,
        value: String(input.paused),
        actorId: input.actorId,
        remark: input.remark
      });
    } else {
      if (input.expectedRevision !== current.revision) throw new EntityVersionConflictError();
      updated = await this.repository.update({
        key: METADATA_KEY,
        value: String(input.paused),
        expectedRevision: current.revision,
        actorId: input.actorId,
        remark: input.remark
      });
    }
    this.featureFlags.setPaused(input.paused);
    return toStatus(updated);
  }
}

export async function readRealMutationsPaused(repository: AppMetadataRepository): Promise<boolean> {
  return (await repository.get(METADATA_KEY))?.value === 'true';
}

function toStatus(metadata: AppMetadata | null): RealMutationControlStatus {
  return {
    paused: metadata?.value === 'true',
    revision: metadata?.revision ?? null,
    updateTimeUtc: metadata?.updateTimeUtc ?? null,
    updaterId: metadata?.updaterId ?? null,
    remark: metadata?.remark ?? null
  };
}
