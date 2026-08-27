import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface PrivacyPageDefinition {
  canonicalUrl: string;
  input: string;
  language: 'en' | 'zh-CN';
  output: string;
  title: string;
}

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const definitions: PrivacyPageDefinition[] = [
  {
    canonicalUrl: 'https://github.com/OKFred/oneVegetable/blob/master/docs/privacy-policy.md',
    input: 'docs/privacy-policy.md',
    language: 'zh-CN',
    output: 'apps/extension/public/privacy.html',
    title: '一根青菜隐私政策'
  },
  {
    canonicalUrl: 'https://github.com/OKFred/oneVegetable/blob/master/docs/privacy-policy.en.md',
    input: 'docs/privacy-policy.en.md',
    language: 'en',
    output: 'apps/extension/public/privacy-en.html',
    title: 'oneVegetable Privacy Policy'
  }
];

for (const definition of definitions) {
  const markdown = await readFile(resolve(root, definition.input), 'utf8');
  const output = renderPage(definition, markdown);
  const target = resolve(root, definition.output);
  if (check) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== output) {
      throw new Error(`Generated privacy page is stale: ${definition.output}. Run pnpm generate:privacy.`);
    }
  } else {
    await writeFile(target, output, 'utf8');
  }
}

function renderPage(definition: PrivacyPageDefinition, markdown: string): string {
  const alternate = definition.language === 'zh-CN' ? 'privacy-en.html' : 'privacy.html';
  const alternateLabel = definition.language === 'zh-CN' ? 'English' : '简体中文';
  const currentLabel = definition.language === 'zh-CN' ? '简体中文' : 'English';
  return `<!doctype html>
<html lang="${definition.language}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'">
    <title>${escapeHtml(definition.title)}</title>
    <meta name="description" content="${escapeHtml(definition.title)}">
    <link rel="canonical" href="${definition.canonicalUrl}">
    <link rel="alternate" hreflang="zh-CN" href="privacy.html">
    <link rel="alternate" hreflang="en" href="privacy-en.html">
    <link rel="alternate" hreflang="x-default" href="privacy-en.html">
    <link rel="stylesheet" href="privacy.css">
  </head>
  <body>
    <main>
      <nav class="language-switcher" aria-label="Language">
        <span aria-current="page">${currentLabel}</span>
        <a href="${alternate}" hreflang="${definition.language === 'zh-CN' ? 'en' : 'zh-CN'}" lang="${definition.language === 'zh-CN' ? 'en' : 'zh-CN'}">${alternateLabel}</a>
      </nav>
${renderMarkdown(markdown)}
    </main>
  </body>
</html>
`;
}

function renderMarkdown(markdown: string): string {
  const output: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph
      .map((line) => (line.endsWith('  ') ? `${line.slice(0, -2)}\n` : line))
      .join(' ')
      .split('\n')
      .map((line) => renderInline(line.trimStart()))
      .join('<br>\n');
    output.push(`      <p>${text}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length === 0) return;
    output.push('      <ul>', ...list.map((item) => `        <li>${renderInline(item)}</li>`), '      </ul>');
    list = [];
  };

  for (const rawLine of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,2})\s+(.+)$/u.exec(line);
    const listItem = /^-\s+(.+)$/u.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length === 1 ? 'h1' : 'h2';
      output.push(`      <${level}>${renderInline(heading[2] ?? '')}</${level}>`);
    } else if (listItem) {
      flushParagraph();
      list.push(listItem[1] ?? '');
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(rawLine);
    }
  }
  flushParagraph();
  flushList();
  return output.join('\n');
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/gu, '<a href="$2" rel="noopener noreferrer">$1</a>');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
