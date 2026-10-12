/** Public documentation only: no browser cookies, application credentials or business API calls. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NetworkManager } from '../packages/core/src/network';
import { isRecord } from '../packages/core/src/alibaba-iop';

const origin = 'https://openapi.alibaba.com';
const network = new NetworkManager({
  policies: {
    bff: { allowedOrigins: [origin], maxResponseBytes: 4 * 1024 * 1024, timeoutMilliseconds: 30_000 }
  }
});
async function document(path: string, parameters: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(path, origin);
  url.search = new URLSearchParams(parameters).toString();
  const response = await network.request({ service: 'bff', url: url.href, responseType: 'json' });
  if (!response.ok || !isRecord(response.data) || response.data.success !== true)
    throw new Error(`Public IOP documentation unavailable: ${path}`);
  return response.data.data;
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function nodes(value: unknown): unknown[] {
  return isRecord(value) && Array.isArray(value.data) ? value.data : [];
}
function parameters(value: unknown): unknown[] {
  return nodes(value).map((node) => {
    if (!isRecord(node) || typeof node.name !== 'string' || typeof node.type !== 'string')
      throw new Error('Invalid public IOP parameter node');
    return {
      name: node.name,
      type: node.type,
      required: node.required === true,
      description: text(node.desc),
      ...(Array.isArray(node.children) && node.children.length
        ? { children: parameters({ data: node.children }) }
        : {})
    };
  });
}
const raw = await document('/handler/share/apidoc/getApiCategoryMixed.json');
if (!Array.isArray(raw)) throw new Error('Invalid public IOP catalog');
const catalog = raw.flatMap((category) => {
  if (!isRecord(category) || !Number.isSafeInteger(category.id) || !Array.isArray(category.apiList))
    throw new Error('Invalid public IOP category');
  const apis: unknown[] = category.apiList;
  return apis.map((api) => {
    if (!isRecord(api) || typeof api.path !== 'string' || typeof api.methodType !== 'string')
      throw new Error('Invalid public IOP method');
    return {
      categoryId: Number(category.id),
      category: text(category.name),
      title: text(api.title),
      path: api.path,
      httpMethods: api.methodType
    };
  });
});
const selected = catalog.filter(
  (api) => api.categoryId === 1 || (api.categoryId === 8 && /(?:list|get|query)$/u.test(api.path))
);
const documents = [];
for (const api of selected) {
  const data = await document('/handler/share/apidoc/getApi.json', {
    cid: String(api.categoryId),
    path: api.path,
    methodType: api.httpMethods
  });
  if (!isRecord(data) || !Array.isArray(data.apiList)) throw new Error(`Missing document: ${api.path}`);
  const definitions: unknown[] = data.apiList;
  const detail = definitions.find((item) => isRecord(item) && item.path === api.path);
  if (!isRecord(detail)) throw new Error(`Document path mismatch: ${api.path}`);
  documents.push({
    ...api,
    documentUrl: `${origin}/doc/api.htm#/api?${new URLSearchParams({
      cid: String(api.categoryId),
      path: api.path,
      methodType: api.httpMethods
    })}`,
    updatedAt: text(detail.lastModified),
    chargeable: detail.chargeable === true,
    authorizationType: typeof data.authType === 'number' ? data.authType : null,
    description: text(detail.desc),
    request: parameters(detail.parameters),
    response: parameters(detail.outputParameters),
    errors: nodes(detail.errorCodes).map((error) =>
      isRecord(error)
        ? { code: text(error.code), description: text(error.codeDesc), remedy: text(error.solution) }
        : {}
    )
  });
  await new Promise((done) => setTimeout(done, 350));
}
await writeFile(
  resolve('docs/alibaba-iop-api-docs.json'),
  `${JSON.stringify({ schemaVersion: 1, checkedAt: new Date().toISOString(), catalog, documents }, null, 2)}\n`,
  'utf8'
);
process.stdout.write(
  `Public IOP snapshot: ${catalog.length} catalog methods, ${documents.length} documents; no account data.\n`
);
