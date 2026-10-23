import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCapabilityDefinition, listCapabilities } from '../../packages/core/src/capability-registry';
import { IOP_METHODS } from '../../packages/core/src/alibaba-iop-registry';
import { buildProtocolRegistration, type IopDocumentationSnapshot } from './alibaba-protocol-registration';

const snapshot = JSON.parse(
  readFileSync(new URL('../../docs/alibaba-iop-api-docs.json', import.meta.url), 'utf8')
) as IopDocumentationSnapshot;
const report = buildProtocolRegistration(snapshot);

describe('offline Alibaba protocol registration', () => {
  it('regenerates the complete checked-in report in memory', () => {
    const saved: unknown = JSON.parse(
      readFileSync(new URL('../../docs/alibaba-protocol-registration.json', import.meta.url), 'utf8')
    );
    expect(saved).toEqual(report);
    expect(report.entries.map((entry) => entry.method)).toEqual(
      [...new Set([...listCapabilities().map((entry) => entry.method), ...Object.keys(IOP_METHODS)])].sort()
    );
  });
  it('requires explicit documentation evidence for both protocol lanes', () => {
    for (const entry of report.entries) {
      expect(['top', 'iop', 'both', 'unconfirmed']).toContain(entry.documentedProtocols);
      if (entry.top.documentation === 'confirmed')
        expect(entry.top.source).toMatch(/^https:\/\/(open\.taobao\.com|developer\.alibaba\.com)\//);
      if (entry.iop.documentation === 'confirmed') {
        expect(snapshot.catalog.some((item) => item.path === entry.iop.path)).toBe(true);
        expect(entry.iop.source).toMatch(/^https:\/\/openapi\.alibaba\.com\/doc\/api.htm/);
      }
    }
  });
  it('preserves verified legacy aliases without turning catalog omission into unsupported', () => {
    const alias = report.entries.find((entry) => entry.method === 'alibaba.icbu.product.group.get');
    expect(alias?.iop).toMatchObject({
      documentation: 'unconfirmed',
      adapted: true,
      accountVerified: true,
      source: null
    });
    expect(alias?.iop.notes.join(' ')).toContain('Verified legacy alias');
    const missing = buildProtocolRegistration({ ...snapshot, catalog: [], documents: [] });
    expect(missing.entries.every((entry) => entry.iop.documentation === 'unconfirmed')).toBe(true);
  });
  it('never inherits TOP account acceptance or description-based protocol claims into IOP', () => {
    const changed = buildProtocolRegistration(snapshot, {
      capabilities: listCapabilities(),
      definitionFor: (method) => {
        const definition = getCapabilityDefinition(method);
        return definition ? { ...definition, verification: 'account-verified' } : null;
      },
      iopMethods: IOP_METHODS
    });
    expect(changed.entries.map((entry) => entry.iop)).toEqual(report.entries.map((entry) => entry.iop));
    const method = 'alibaba.scbp.showcase.list';
    const invented = buildProtocolRegistration({
      ...snapshot,
      catalog: [
        ...snapshot.catalog,
        {
          title: 'Different method with TOP and IOP in its description',
          path: '/guessed/showcase/list',
          categoryId: 1,
          httpMethods: 'GET/POST'
        }
      ]
    }).entries.find((entry) => entry.method === method);
    expect(invented?.iop.documentation).toBe('unconfirmed');
    expect(invented?.iop.path).toBeNull();
  });
});
