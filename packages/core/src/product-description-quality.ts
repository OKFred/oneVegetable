import type { ProductSchemaFieldIssue } from './product-schema';
import type { ProductSchemaOfficialHint } from './product-official-hints';
import type { ProductDescriptionQualityIssue } from './types';

export interface ProductDescriptionImageMetadata {
  width: number;
  height: number;
  loaded: boolean;
}

export interface ProductDescriptionQualityInput {
  html: string;
  schemaIssues?: ProductSchemaFieldIssue[];
  officialHints?: ProductSchemaOfficialHint[];
  imageMetadata?: Readonly<Record<string, ProductDescriptionImageMetadata>>;
}

export function analyzeProductDescriptionQuality(
  input: ProductDescriptionQualityInput
): ProductDescriptionQualityIssue[] {
  const issues: ProductDescriptionQualityIssue[] = [];
  appendSchemaIssues(input.schemaIssues ?? [], issues);
  appendOfficialIssues(input.officialHints ?? [], issues);

  const document = new DOMParser().parseFromString(input.html, 'text/html');
  const text = normalizeText(document.body.textContent);
  const englishWordCount = Array.from(text.matchAll(/\b[A-Za-z]+(?:['-][A-Za-z]+)*\b/g)).length;
  const images = Array.from(document.body.querySelectorAll('img'));

  if (!text && images.length === 0) {
    issues.push(
      projectIssue('empty-description', '商品详情为空', '补充面向买家的产品介绍、卖点、规格与应用场景。')
    );
  }
  if (text && englishWordCount < 150) {
    issues.push(
      projectIssue(
        'short-description',
        `英文正文约 ${englishWordCount} 个单词，少于项目建议的 150 个`,
        '补充核心卖点、规格参数、应用场景、包装和售后信息。'
      )
    );
  }
  if (englishWordCount > 300 && !document.body.querySelector('h2,h3,h4')) {
    issues.push(
      projectIssue(
        'long-description-without-heading',
        '英文正文超过 300 个单词但没有分段标题',
        '使用二至四级标题组织卖点、规格、场景和服务信息。'
      )
    );
  }

  for (const [index, paragraph] of Array.from(document.body.querySelectorAll('p')).entries()) {
    const length = Array.from(normalizeText(paragraph.textContent)).length;
    if (length > 600) {
      issues.push(
        projectIssue(
          'long-paragraph',
          `第 ${index + 1} 段超过 600 个字符`,
          '拆分长段落，并用标题或列表提高可读性。'
        )
      );
    }
  }

  appendImageIssues(images, input.imageMetadata ?? {}, issues);
  appendEmptyStructureIssues(document, issues);
  appendContactIssues(text, document, issues);
  return deduplicateIssues(issues);
}

function appendSchemaIssues(
  schemaIssues: ProductSchemaFieldIssue[],
  output: ProductDescriptionQualityIssue[]
): void {
  for (const issue of schemaIssues) {
    output.push({
      code: `schema-${issue.rule}`,
      source: 'alibaba-schema',
      level: issue.severity === 'error' ? 'error' : 'warning',
      message: issue.message,
      remediation:
        issue.severity === 'error'
          ? '补齐商品名称、主图等最低发布条件后再提交。'
          : '建议提交前核对；本地预检不会阻止提交，最终以 Alibaba 接口返回为准。',
      fieldIds: [issue.fieldKey]
    });
  }
}

function appendOfficialIssues(
  hints: ProductSchemaOfficialHint[],
  output: ProductDescriptionQualityIssue[]
): void {
  for (const hint of hints) {
    output.push({
      code: hint.id,
      source: 'official',
      level: 'warning',
      message: hint.summary,
      remediation: '参考官方提示完善内容；该提示不会阻止提交。',
      fieldIds: hint.fieldKeys
    });
  }
}

function appendImageIssues(
  images: HTMLImageElement[],
  metadata: Readonly<Record<string, ProductDescriptionImageMetadata>>,
  output: ProductDescriptionQualityIssue[]
): void {
  const occurrences = new Map<string, number>();
  for (const image of images) {
    const src = image.getAttribute('src') ?? '';
    occurrences.set(src, (occurrences.get(src) ?? 0) + 1);
    if (!image.getAttribute('alt')?.trim()) {
      output.push(
        projectIssue('image-missing-alt', '详情图片缺少 alt 文本', '为图片补充简洁、准确的英文说明。')
      );
    }
    if (!isAlibabaPhotoBankUrl(src)) {
      output.push(
        projectIssue(
          'external-image',
          '详情中包含非国际站图库来源的图片',
          '先将图片转存到国际站图库，再从素材选择器插入。'
        )
      );
    }
    const imageStatus = metadata[src];
    if (imageStatus?.loaded === false) {
      output.push(
        projectIssue('image-load-failed', '详情图片无法加载', '检查素材是否已删除、过期或不可公开访问。')
      );
    }
    const width = imageStatus?.width ?? numericAttribute(image, 'data-photobank-width');
    const height = imageStatus?.height ?? numericAttribute(image, 'data-photobank-height');
    if (width !== undefined && height !== undefined && (width < 750 || height < 750)) {
      output.push(
        projectIssue(
          'low-resolution-image',
          `详情图片尺寸 ${width}×${height}，低于项目建议的 750×750`,
          '替换为宽高均不低于 750 像素的清晰素材。'
        )
      );
    }
  }
  if (Array.from(occurrences.values()).some((count) => count > 1)) {
    output.push(
      projectIssue('duplicate-image', '详情中存在重复图片', '删除重复素材或替换为不同角度和场景图。')
    );
  }
}

function appendEmptyStructureIssues(document: Document, output: ProductDescriptionQualityIssue[]): void {
  if (
    Array.from(document.body.querySelectorAll('table')).some(
      (table) => !normalizeText(table.textContent) && !table.querySelector('img')
    )
  ) {
    output.push(projectIssue('empty-table', '详情中存在空表格', '填写表格内容或删除空表格。'));
  }
  if (
    Array.from(document.body.querySelectorAll('ul,ol')).some(
      (list) => !Array.from(list.querySelectorAll('li')).some((item) => normalizeText(item.textContent))
    )
  ) {
    output.push(projectIssue('empty-list', '详情中存在空列表', '填写列表项或删除空列表。'));
  }
}

function appendContactIssues(
  text: string,
  document: Document,
  output: ProductDescriptionQualityIssue[]
): void {
  const contactPattern =
    /(?:\b(?:whats?app|wechat|weixin|skype|telegram)\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?\d[\d\s().-]{7,}\d))/iu;
  const hasExternalLink = Array.from(document.body.querySelectorAll('a[href]')).some((anchor) => {
    try {
      const hostname = new URL(anchor.getAttribute('href') ?? '').hostname.toLocaleLowerCase();
      return !(
        hostname === 'alibaba.com' ||
        hostname.endsWith('.alibaba.com') ||
        hostname === 'aliexpress.com' ||
        hostname.endsWith('.aliexpress.com')
      );
    } catch {
      return false;
    }
  });
  if (contactPattern.test(text) || hasExternalLink) {
    output.push(
      projectIssue(
        'contact-or-external-traffic',
        '详情中可能包含联系方式或外部引流信息',
        '核对国际站内容规范，删除站外联系方式、收款方式或引流链接。'
      )
    );
  }
}

function projectIssue(code: string, message: string, remediation: string): ProductDescriptionQualityIssue {
  return { code, source: 'project', level: 'suggestion', message, remediation, fieldIds: ['superText'] };
}

function deduplicateIssues(issues: ProductDescriptionQualityIssue[]): ProductDescriptionQualityIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.source}:${issue.code}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value: string | null): string {
  return (value ?? '').replaceAll(/\s+/g, ' ').trim();
}

function numericAttribute(element: Element, name: string): number | undefined {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isAlibabaPhotoBankUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
    const hostname = url.hostname.toLocaleLowerCase();
    return url.protocol === 'https:' && (hostname === 'alicdn.com' || hostname.endsWith('.alicdn.com'));
  } catch {
    return false;
  }
}
