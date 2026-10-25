import { getCapabilityDefinition, listCapabilities } from '../../packages/core/src/capability-registry';
import {
  IOP_METHODS,
  listIopOperationCoverage,
  type IopMethodDefinition
} from '../../packages/core/src/alibaba-iop-registry';
import type { ApiCapability, CapabilityDefinition } from '../../packages/core/src/types';

interface CatalogEntry {
  title: string;
  path: string;
  categoryId: number;
  httpMethods: string;
}
export interface IopDocumentationSnapshot {
  checkedAt: string;
  catalog: readonly CatalogEntry[];
  documents: readonly { path: string; documentUrl: string }[];
}
interface RegistrationSources {
  capabilities: readonly ApiCapability[];
  definitionFor: (method: string) => CapabilityDefinition | null;
  iopMethods: Readonly<Record<string, Readonly<IopMethodDefinition>>>;
}
export type DocumentedProtocols = 'top' | 'iop' | 'both' | 'unconfirmed';

function topDocumentConfirmed(source: string | null): boolean {
  if (!source) return false;
  const url = new URL(source);
  return (
    url.protocol === 'https:' &&
    ((url.hostname === 'open.taobao.com' &&
      url.pathname === '/api.htm' &&
      /^\d+$/.test(url.searchParams.get('docId') ?? '')) ||
      (url.hostname === 'developer.alibaba.com' &&
        url.pathname === '/docs/api.htm' &&
        /^\d+$/.test(url.searchParams.get('apiId') ?? '')))
  );
}

/** Offline evidence only. No description/path heuristics, runtime routing or application grants. */
export function buildProtocolRegistration(
  snapshot: IopDocumentationSnapshot,
  sources: RegistrationSources = {
    capabilities: listCapabilities(),
    definitionFor: getCapabilityDefinition,
    iopMethods: IOP_METHODS
  }
) {
  const capabilities = new Map(sources.capabilities.map((capability) => [capability.method, capability]));
  if (capabilities.size !== sources.capabilities.length) throw new Error('Duplicate capability registration');
  const coverage = listIopOperationCoverage();
  const methods = [...new Set([...capabilities.keys(), ...Object.keys(sources.iopMethods)])].sort();
  const entries = methods.map((method) => {
    const capability = capabilities.get(method);
    const definition = sources.definitionFor(method);
    const iop = sources.iopMethods[method];
    const nativeIop = method.startsWith('/');
    const topSource = nativeIop ? null : (definition?.docUrl ?? capability?.docUrl ?? null);
    const topConfirmed = topDocumentConfirmed(topSource);
    // Exact catalog titles or explicit adapter mappings only; never rewrite dots into paths.
    const candidates = snapshot.catalog.filter((entry) =>
      iop ? entry.path === iop.path : entry.title === method
    );
    if (candidates.length > 1) throw new Error(`Ambiguous IOP documentation: ${method}`);
    const catalog = candidates[0];
    const iopConfirmed = catalog !== undefined;
    const document = catalog && snapshot.documents.find((entry) => entry.path === catalog.path);
    const iopSource = catalog
      ? (document?.documentUrl ??
        `https://openapi.alibaba.com/doc/api.htm#/api?${new URLSearchParams({
          cid: String(catalog.categoryId),
          path: catalog.path,
          methodType: catalog.httpMethods
        })}`)
      : null;
    const documentedProtocols: DocumentedProtocols = topConfirmed
      ? iopConfirmed
        ? 'both'
        : 'top'
      : iopConfirmed
        ? 'iop'
        : 'unconfirmed';
    const topConstraints = [
      ...(capability?.auth ? [`authorization:${capability.auth}`] : []),
      ...(capability?.jushitaOnly ? ['jushita-only'] : []),
      ...(capability?.restricted ? [`restricted:${capability.restrictionReason ?? 'unspecified'}`] : []),
      ...(capability?.enabled === false ? ['catalog-disabled'] : []),
      ...(definition?.realCallEnabled === false ? ['real-call-disabled'] : []),
      ...(definition?.lifecycle ? [`lifecycle:${definition.lifecycle}`] : [])
    ];
    const iopConstraints = coverage.flatMap((entry) =>
      entry.methods.includes(method)
        ? entry.constraints.map((constraint) => `${entry.operation}:${constraint}`)
        : []
    );
    if (!iop?.adapted) iopConstraints.push('not-adapted');
    if (iop?.risk === 'mutation' && !iop.accountVerified) iopConstraints.push('mutation-unverified');
    if (iop?.verifiedActions) iopConstraints.push(`verified-actions:${iop.verifiedActions.join(',')}`);
    return {
      method,
      documentedProtocols,
      top: {
        documentation: topConfirmed ? ('confirmed' as const) : ('unconfirmed' as const),
        method: !nativeIop && (capability || definition) ? method : null,
        source: topSource,
        adapted: !nativeIop && definition !== null,
        accountVerified:
          !nativeIop && (definition?.verification ?? capability?.verification) === 'account-verified',
        constraints: nativeIop ? ['native-iop-only'] : topConstraints
      },
      iop: {
        documentation: iopConfirmed ? ('confirmed' as const) : ('unconfirmed' as const),
        path: iop?.path ?? catalog?.path ?? null,
        source: iopSource,
        adapted: iop?.adapted ?? false,
        accountVerified: iop?.accountVerified ?? false,
        authorizationRequired: iop?.authorizationRequired ?? null,
        constraints: [...new Set(iopConstraints)].sort(),
        notes:
          !catalog && iop?.accountVerified
            ? ['Verified legacy alias absent from this catalog snapshot; documentation remains unconfirmed.']
            : !catalog
              ? ['Absent from this catalog snapshot is not evidence of protocol nonexistence.']
              : []
      }
    };
  });
  return {
    schemaVersion: 1,
    catalogCheckedAt: snapshot.checkedAt,
    scope:
      'Offline documentation and implementation evidence only; not application permission, business qualification, runtime routing or write authorization.',
    verificationSources: {
      top: 'Existing TOP capability definition/catalog verification labels; not reverified by this generator.',
      iop: 'Explicit IOP_METHODS accountVerified flags only; never inherited from TOP.'
    },
    entries
  };
}
