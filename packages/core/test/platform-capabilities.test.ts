import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getCapabilityDefinition,
  isPlatformCapabilityMethod,
  listCapabilityDefinitions,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';

interface PlatformSnapshot {
  catalogCount: number;
  definitions: { method: string; restricted: boolean }[];
}

async function readSnapshot(): Promise<PlatformSnapshot> {
  const source = await readFile(
    resolve(import.meta.dirname, '../../../docs/alibaba-platform-api-docs.json'),
    'utf8'
  );
  return JSON.parse(source) as PlatformSnapshot;
}

describe('typed platform collaboration capability domain', () => {
  it('registers the final three catalog methods as platform capabilities', async () => {
    const snapshot = await readSnapshot();
    const methods = new Set(snapshot.definitions.map((definition) => definition.method));
    const definitions = listCapabilityDefinitions().filter((definition) => methods.has(definition.method));

    expect(snapshot.catalogCount).toBe(3);
    expect(definitions).toHaveLength(3);
    expect(isPlatformCapabilityMethod('alibaba.icbu.risk.send')).toBe(true);
  });

  it('compiles strict request and response validators for every method', async () => {
    const snapshot = await readSnapshot();
    for (const { method } of snapshot.definitions) {
      const definition = getCapabilityDefinition(method);
      expect(definition, method).not.toBeNull();
      expect(await validateCapabilityRequest(method, definition?.requestExample), method).toEqual([]);
      expect(await validateCapabilityResponse(method, definition?.responseExample), method).toEqual([]);
    }
  });

  it('treats all three calls as mutations and protects protocol integrations', () => {
    expect(getCapabilityDefinition('alibaba.icbu.file.urlposting.upload')).toMatchObject({
      featureArea: 'fileTransfer',
      risk: 'mutation',
      restricted: false,
      realCallEnabled: false
    });
    expect(getCapabilityDefinition('alibaba.icbu.risk.send')).toMatchObject({
      featureArea: 'riskAssessment',
      risk: 'mutation',
      restricted: true,
      realCallEnabled: false
    });
    expect(getCapabilityDefinition('alibaba.icbu.task.status.notify')).toMatchObject({
      featureArea: 'taskCallback',
      risk: 'mutation',
      restricted: true,
      realCallEnabled: false
    });
  });

  it('rejects missing nested risk fields and unknown task callback fields', async () => {
    expect(await validateCapabilityRequest('alibaba.icbu.risk.send', { event_data: {} })).not.toEqual([]);
    expect(
      await validateCapabilityRequest('alibaba.icbu.task.status.notify', {
        task_key: 'task',
        isv: 'vendor',
        task_status: 'EXECUTE_FINISHED',
        secret: 'must-not-pass'
      })
    ).not.toEqual([]);
  });
});
