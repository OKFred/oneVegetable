/** Reads checked-in metadata only. Never fetches documentation or calls a provider. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  buildProtocolRegistration,
  type IopDocumentationSnapshot
} from './lib/alibaba-protocol-registration';

const target = new URL('../docs/alibaba-protocol-registration.json', import.meta.url);
const snapshot = JSON.parse(
  await readFile(new URL('../docs/alibaba-iop-api-docs.json', import.meta.url), 'utf8')
) as IopDocumentationSnapshot;
const report = buildProtocolRegistration(snapshot);
const output = await format(JSON.stringify(report), {
  ...(await resolveConfig(fileURLToPath(target))),
  parser: 'json'
});
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8').catch(() => '')) !== output)
    throw new Error(
      'Protocol registration report is stale. Run pnpm exec tsx scripts/generate-protocol-registration.ts.'
    );
} else {
  await writeFile(target, output, 'utf8');
}
process.stdout.write(`Protocol registration: ${report.entries.length} logical methods; offline only.\n`);
