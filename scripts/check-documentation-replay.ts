import { getCapabilityDefinition, listCapabilities } from '../packages/core/src/index';
import { createDocumentationReplayGateway } from '../apps/api/src/gateway/documentation-replay';

const candidates = listCapabilities().filter(
  (capability) =>
    capability.enabled &&
    capability.lifecycle === 'active' &&
    capability.risk === 'read' &&
    capability.realCallEnabled &&
    !capability.restricted
);
const gateway = createDocumentationReplayGateway();
const failures: string[] = [];
const domainCounts = new Map<string, number>();

for (const capability of candidates) {
  const definition = getCapabilityDefinition(capability.method);
  if (!definition) {
    failures.push(`${capability.method}: missing typed definition`);
    continue;
  }
  if (definition.responseExample === undefined) {
    failures.push(`${capability.method}: missing response example`);
    continue;
  }
  try {
    const response = await gateway.request('callCapability', {
      method: capability.method,
      parameters: definition.requestExample
    });
    if (!response.contractValid) {
      failures.push(`${capability.method}: response example violates its contract`);
      continue;
    }
    domainCounts.set(capability.domain, (domainCounts.get(capability.domain) ?? 0) + 1);
  } catch (error: unknown) {
    failures.push(
      `${capability.method}: ${error instanceof Error ? error.message : 'documentation replay failed'}`
    );
  }
}

if (failures.length > 0) {
  throw new Error(`Documentation replay coverage failed:\n${failures.join('\n')}`);
}

const summary = [...domainCounts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([domain, count]) => `${domain}=${count}`)
  .join(', ');
globalThis.process.stdout.write(
  `documentation replay coverage ${candidates.length}/${candidates.length}: ${summary}\n`
);
