import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { findReleaseNote, parseReleaseNotesDocument, renderReleaseNotesMarkdown } from './lib/release-notes';

const root = resolve(import.meta.dirname, '..');
const tag = process.argv.find((argument) => /^v?\d+\.\d+\.\d+$/.test(argument));
if (!tag) {
  throw new Error('Usage: pnpm release:notes vX.Y.Z [--output path]');
}

const outputFlagIndex = process.argv.indexOf('--output');
const outputPathArgument = outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : undefined;
if (outputFlagIndex >= 0 && !outputPathArgument) {
  throw new Error('--output requires a file path.');
}

const document = parseReleaseNotesDocument(
  JSON.parse(await readFile(resolve(root, 'release-notes/releases.json'), 'utf8')) as unknown
);
const markdown = renderReleaseNotesMarkdown(findReleaseNote(document, tag));

if (outputPathArgument) {
  const outputPath = resolve(root, outputPathArgument);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, 'utf8');
} else {
  process.stdout.write(markdown);
}
