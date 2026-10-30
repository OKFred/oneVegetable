/** Anonymous public documents only; no business calls, cookies or authorization data. */
import { resolve } from 'node:path';
import { NetworkManager } from '../packages/core/src/network';
import { isRecord } from '../packages/core/src/alibaba-iop';
import { writeTextFileWithRetry } from './lib/safe-write';

const paths = [
  '/alibaba/icbu/product/search/v2',
  '/icbu/product/edit-price',
  '/icbu/product/edit-inventory',
  '/alibaba/icbu/draft/delete',
  '/alibaba/icbu/product/status/get/v2'
] as const;
const network = new NetworkManager({
  policies: {
    bff: {
      allowedOrigins: ['https://openapi.alibaba.com'],
      maxResponseBytes: 4 * 1024 * 1024,
      timeoutMilliseconds: 30_000
    }
  }
});
function nodes(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.map((node: unknown) => {
    if (!isRecord(node) || typeof node.name !== 'string' || typeof node.type !== 'string')
      throw new Error('Invalid public parameter');
    return {
      name: node.name,
      type: node.type,
      required: node.required === true,
      description: typeof node.desc === 'string' ? node.desc : '',
      ...(Array.isArray(node.children) && node.children.length
        ? { children: nodes({ data: node.children }) }
        : {})
    };
  });
}
const checkedAt = new Date().toISOString();
const documents = [];
for (const path of paths) {
  const query = new URLSearchParams({ cid: '11', path, methodType: 'GET/POST' });
  const response = await network.request({
    service: 'bff',
    url: 'https://openapi.alibaba.com/handler/share/apidoc/getApi.json?' + query.toString(),
    responseType: 'json',
    maxAttempts: 1
  });
  const body = response.data;
  if (!response.ok || !isRecord(body) || body.success !== true || !isRecord(body.data))
    throw new Error('Public document unavailable: ' + path);
  const data = body.data;
  const detail: unknown = Array.isArray(data.apiList)
    ? data.apiList.find((value: unknown) => isRecord(value) && value.path === path)
    : null;
  if (!isRecord(detail) || detail.chargeable !== false)
    throw new Error('Missing/free status changed: ' + path);
  documents.push({
    path,
    title: detail.title,
    description: detail.desc,
    documentUrl: 'https://openapi.alibaba.com/doc/api.htm#/api?' + query.toString(),
    updatedAt: detail.lastModified,
    checkedAt,
    chargeable: false,
    authorizationType: data.authType,
    request: nodes(detail.parameters),
    response: nodes(detail.outputParameters),
    errors:
      isRecord(detail.errorCodes) && Array.isArray(detail.errorCodes.data)
        ? detail.errorCodes.data.filter(isRecord).map((item) => ({
            code: item.code,
            description: item.codeDesc,
            remedy: item.solution
          }))
        : []
  });
  await new Promise((done) => setTimeout(done, 350));
}
await writeTextFileWithRetry(
  resolve('docs/alibaba-product-workbench-docs.json'),
  JSON.stringify({ schemaVersion: 1, checkedAt, documents }, null, 2) + '\n'
);
console.log('Captured five free public IOP documents; zero business requests.');
