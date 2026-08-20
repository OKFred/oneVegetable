import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getCapabilityDefinition,
  isPhotoCapabilityMethod,
  listCapabilityDefinitions,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';

interface PhotoSnapshot {
  catalogCount: number;
  definitions: { method: string; risk: 'read' | 'mutation' }[];
}

async function readSnapshot(): Promise<PhotoSnapshot> {
  const source = await readFile(
    resolve(import.meta.dirname, '../../../docs/alibaba-photo-api-docs.json'),
    'utf8'
  );
  return JSON.parse(source) as PhotoSnapshot;
}

describe('typed gallery capability domain', () => {
  it('registers all four official gallery methods', async () => {
    const snapshot = await readSnapshot();
    const methods = new Set(snapshot.definitions.map((definition) => definition.method));
    const definitions = listCapabilityDefinitions().filter((definition) => methods.has(definition.method));

    expect(snapshot.catalogCount).toBe(4);
    expect(definitions).toHaveLength(4);
    expect(isPhotoCapabilityMethod('alibaba.icbu.photobank.list')).toBe(true);
  });

  it('validates every documented request and response example', async () => {
    const snapshot = await readSnapshot();
    for (const { method } of snapshot.definitions) {
      const definition = getCapabilityDefinition(method);
      expect(definition, method).not.toBeNull();
      expect(await validateCapabilityRequest(method, definition?.requestExample), method).toEqual([]);
      expect(await validateCapabilityResponse(method, definition?.responseExample), method).toEqual([]);
    }
  });

  it('enables reads and only account-verified mutations', () => {
    expect(getCapabilityDefinition('alibaba.icbu.photobank.list')).toMatchObject({
      risk: 'read',
      realCallEnabled: true
    });
    expect(getCapabilityDefinition('alibaba.icbu.photobank.upload')).toMatchObject({
      risk: 'mutation',
      realCallEnabled: false
    });
    expect(getCapabilityDefinition('alibaba.icbu.photobank.group.operate')).toMatchObject({
      risk: 'mutation',
      verification: 'account-verified',
      realCallEnabled: true
    });
  });
});
