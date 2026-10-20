/** Public metadata only. No credentials, provider calls or inherited TOP acceptance. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { IOP_METHODS, listIopOperationCoverage } from '../packages/core/src/alibaba-iop-registry';

const target = new URL('../docs/alibaba-iop-feature-coverage.json', import.meta.url);
const snapshot = JSON.parse(
  await readFile(new URL('../docs/alibaba-iop-api-docs.json', import.meta.url), 'utf8')
) as {
  checkedAt: string;
  catalog: { path: string }[];
};
for (const [method, definition] of Object.entries(IOP_METHODS)) {
  if (
    method !== 'alibaba.icbu.product.group.get' &&
    !snapshot.catalog.some((entry) => entry.path === definition.path)
  )
    throw new Error(`IOP method is missing from the public catalog snapshot: ${method}`);
}
const report = {
  schemaVersion: 1,
  catalogCheckedAt: snapshot.checkedAt,
  note: 'Protocol coverage is not application permission, business qualification or runtime write authorization.',
  methods: IOP_METHODS,
  operations: listIopOperationCoverage()
};
const text = await format(JSON.stringify(report), {
  ...(await resolveConfig(fileURLToPath(target))),
  parser: 'json'
});
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')) !== text)
    throw new Error('IOP coverage report is stale. Run tsx scripts/report-iop-coverage.ts --write.');
} else if (process.argv.includes('--write')) {
  await writeFile(target, text, 'utf8');
}
process.stdout.write(
  `IOP coverage: ${report.operations.length} operations, ${Object.keys(report.methods).length} explicit methods. No live API calls.\n`
);
