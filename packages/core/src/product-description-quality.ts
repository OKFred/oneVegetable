import type { ProductSchemaFieldIssue } from './product-schema';
import type { ProductSchemaOfficialHint } from './product-official-hints';
import type { UiLocale } from './preferences';
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
  locale?: UiLocale;
}

export function analyzeProductDescriptionQuality(
  input: ProductDescriptionQualityInput
): ProductDescriptionQualityIssue[] {
  const locale = input.locale ?? 'zh-CN';
  const issues: ProductDescriptionQualityIssue[] = [];
  appendSchemaIssues(input.schemaIssues ?? [], issues, locale);
  appendOfficialIssues(input.officialHints ?? [], issues, locale);

  const document = new DOMParser().parseFromString(input.html, 'text/html');
  const text = normalizeText(document.body.textContent);
  const englishWordCount = Array.from(text.matchAll(/\b[A-Za-z]+(?:['-][A-Za-z]+)*\b/g)).length;
  const images = Array.from(document.body.querySelectorAll('img'));

  if (!text && images.length === 0) {
    issues.push(
      projectIssue(
        'empty-description',
        qualityMessage(locale, 'emptyDescription'),
        qualityMessage(locale, 'emptyDescriptionRemediation')
      )
    );
  }
  if (text && englishWordCount < 150) {
    issues.push(
      projectIssue(
        'short-description',
        qualityMessage(locale, 'shortDescription', { count: englishWordCount }),
        qualityMessage(locale, 'shortDescriptionRemediation')
      )
    );
  }
  if (englishWordCount > 300 && !document.body.querySelector('h2,h3,h4')) {
    issues.push(
      projectIssue(
        'long-description-without-heading',
        qualityMessage(locale, 'longWithoutHeading'),
        qualityMessage(locale, 'longWithoutHeadingRemediation')
      )
    );
  }

  for (const [index, paragraph] of Array.from(document.body.querySelectorAll('p')).entries()) {
    const length = Array.from(normalizeText(paragraph.textContent)).length;
    if (length > 600) {
      issues.push(
        projectIssue(
          'long-paragraph',
          qualityMessage(locale, 'longParagraph', { index: index + 1 }),
          qualityMessage(locale, 'longParagraphRemediation')
        )
      );
    }
  }

  appendImageIssues(images, input.imageMetadata ?? {}, issues, locale);
  appendEmptyStructureIssues(document, issues, locale);
  appendContactIssues(text, document, issues, locale);
  return deduplicateIssues(issues);
}

function appendSchemaIssues(
  schemaIssues: ProductSchemaFieldIssue[],
  output: ProductDescriptionQualityIssue[],
  locale: UiLocale
): void {
  for (const issue of schemaIssues) {
    output.push({
      code: `schema-${issue.rule}`,
      source: 'alibaba-schema',
      level: issue.severity === 'error' ? 'error' : 'warning',
      message: issue.message,
      remediation:
        issue.severity === 'error'
          ? qualityMessage(locale, 'schemaErrorRemediation')
          : qualityMessage(locale, 'schemaWarningRemediation'),
      fieldIds: [issue.fieldKey]
    });
  }
}

function appendOfficialIssues(
  hints: ProductSchemaOfficialHint[],
  output: ProductDescriptionQualityIssue[],
  locale: UiLocale
): void {
  for (const hint of hints) {
    output.push({
      code: hint.id,
      source: 'official',
      level: 'warning',
      message: hint.summary,
      remediation: qualityMessage(locale, 'officialRemediation'),
      fieldIds: hint.fieldKeys
    });
  }
}

function appendImageIssues(
  images: HTMLImageElement[],
  metadata: Readonly<Record<string, ProductDescriptionImageMetadata>>,
  output: ProductDescriptionQualityIssue[],
  locale: UiLocale
): void {
  const occurrences = new Map<string, number>();
  for (const image of images) {
    const src = image.getAttribute('src') ?? '';
    occurrences.set(src, (occurrences.get(src) ?? 0) + 1);
    if (!image.getAttribute('alt')?.trim()) {
      output.push(
        projectIssue(
          'image-missing-alt',
          qualityMessage(locale, 'missingAlt'),
          qualityMessage(locale, 'missingAltRemediation')
        )
      );
    }
    if (!isAlibabaPhotoBankUrl(src)) {
      output.push(
        projectIssue(
          'external-image',
          qualityMessage(locale, 'externalImage'),
          qualityMessage(locale, 'externalImageRemediation')
        )
      );
    }
    const imageStatus = metadata[src];
    if (imageStatus?.loaded === false) {
      output.push(
        projectIssue(
          'image-load-failed',
          qualityMessage(locale, 'imageLoadFailed'),
          qualityMessage(locale, 'imageLoadFailedRemediation')
        )
      );
    }
    const width = imageStatus?.width ?? numericAttribute(image, 'data-photobank-width');
    const height = imageStatus?.height ?? numericAttribute(image, 'data-photobank-height');
    if (width !== undefined && height !== undefined && (width < 750 || height < 750)) {
      output.push(
        projectIssue(
          'low-resolution-image',
          qualityMessage(locale, 'lowResolution', { width, height }),
          qualityMessage(locale, 'lowResolutionRemediation')
        )
      );
    }
  }
  if (Array.from(occurrences.values()).some((count) => count > 1)) {
    output.push(
      projectIssue(
        'duplicate-image',
        qualityMessage(locale, 'duplicateImage'),
        qualityMessage(locale, 'duplicateImageRemediation')
      )
    );
  }
}

function appendEmptyStructureIssues(
  document: Document,
  output: ProductDescriptionQualityIssue[],
  locale: UiLocale
): void {
  if (
    Array.from(document.body.querySelectorAll('table')).some(
      (table) => !normalizeText(table.textContent) && !table.querySelector('img')
    )
  ) {
    output.push(
      projectIssue(
        'empty-table',
        qualityMessage(locale, 'emptyTable'),
        qualityMessage(locale, 'emptyTableRemediation')
      )
    );
  }
  if (
    Array.from(document.body.querySelectorAll('ul,ol')).some(
      (list) => !Array.from(list.querySelectorAll('li')).some((item) => normalizeText(item.textContent))
    )
  ) {
    output.push(
      projectIssue(
        'empty-list',
        qualityMessage(locale, 'emptyList'),
        qualityMessage(locale, 'emptyListRemediation')
      )
    );
  }
}

function appendContactIssues(
  text: string,
  document: Document,
  output: ProductDescriptionQualityIssue[],
  locale: UiLocale
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
        qualityMessage(locale, 'externalTraffic'),
        qualityMessage(locale, 'externalTrafficRemediation')
      )
    );
  }
}

const PRODUCT_QUALITY_MESSAGES = {
  'zh-CN': {
    emptyDescription: '商品详情为空',
    emptyDescriptionRemediation: '补充面向买家的产品介绍、卖点、规格与应用场景。',
    shortDescription: '英文正文约 {count} 个单词，少于项目建议的 150 个',
    shortDescriptionRemediation: '补充核心卖点、规格参数、应用场景、包装和售后信息。',
    longWithoutHeading: '英文正文超过 300 个单词但没有分段标题',
    longWithoutHeadingRemediation: '使用二至四级标题组织卖点、规格、场景和服务信息。',
    longParagraph: '第 {index} 段超过 600 个字符',
    longParagraphRemediation: '拆分长段落，并用标题或列表提高可读性。',
    schemaErrorRemediation: '补齐商品名称、主图等最低发布条件后再提交。',
    schemaWarningRemediation: '建议提交前核对；本地预检不会阻止提交，最终以 Alibaba 接口返回为准。',
    officialRemediation: '参考官方提示完善内容；该提示不会阻止提交。',
    missingAlt: '详情图片缺少 alt 文本',
    missingAltRemediation: '为图片补充简洁、准确的英文说明。',
    externalImage: '详情中包含非国际站图库来源的图片',
    externalImageRemediation: '先将图片转存到国际站图库，再从素材选择器插入。',
    imageLoadFailed: '详情图片无法加载',
    imageLoadFailedRemediation: '检查素材是否已删除、过期或不可公开访问。',
    lowResolution: '详情图片尺寸 {width}×{height}，低于项目建议的 750×750',
    lowResolutionRemediation: '替换为宽高均不低于 750 像素的清晰素材。',
    duplicateImage: '详情中存在重复图片',
    duplicateImageRemediation: '删除重复素材或替换为不同角度和场景图。',
    emptyTable: '详情中存在空表格',
    emptyTableRemediation: '填写表格内容或删除空表格。',
    emptyList: '详情中存在空列表',
    emptyListRemediation: '填写列表项或删除空列表。',
    externalTraffic: '详情中可能包含联系方式或外部引流信息',
    externalTrafficRemediation: '核对国际站内容规范，删除站外联系方式、收款方式或引流链接。'
  },
  'en-US': {
    emptyDescription: 'Product description is empty',
    emptyDescriptionRemediation:
      'Add a buyer-facing introduction, selling points, specifications, and use cases.',
    shortDescription:
      'The English body contains about {count} words, below the project recommendation of 150',
    shortDescriptionRemediation:
      'Add core selling points, specifications, use cases, packaging, and after-sales information.',
    longWithoutHeading: 'The English body exceeds 300 words but has no section headings',
    longWithoutHeadingRemediation:
      'Use level-two through level-four headings to organize selling points, specifications, scenarios, and service information.',
    longParagraph: 'Paragraph {index} exceeds 600 characters',
    longParagraphRemediation: 'Split long paragraphs and use headings or lists to improve readability.',
    schemaErrorRemediation:
      'Provide the minimum publishing requirements, such as product name and main image, before submission.',
    schemaWarningRemediation:
      'Review before submission. Local preflight does not block submission; the Alibaba API response is final.',
    officialRemediation:
      'Improve the content according to the official hint. This hint does not block submission.',
    missingAlt: 'A description image is missing alt text',
    missingAltRemediation: 'Add a concise and accurate English description for the image.',
    externalImage: 'The description contains an image that is not from the Alibaba.com gallery',
    externalImageRemediation:
      'Transfer the image to the Alibaba.com gallery, then insert it through the asset selector.',
    imageLoadFailed: 'A description image could not be loaded',
    imageLoadFailedRemediation:
      'Check whether the asset was deleted, expired, or is not publicly accessible.',
    lowResolution: 'Description image size {width}×{height} is below the project recommendation of 750×750',
    lowResolutionRemediation: 'Replace it with a clear asset at least 750 pixels wide and high.',
    duplicateImage: 'The description contains duplicate images',
    duplicateImageRemediation: 'Remove duplicates or use images showing different angles and scenarios.',
    emptyTable: 'The description contains an empty table',
    emptyTableRemediation: 'Fill in the table or remove it.',
    emptyList: 'The description contains an empty list',
    emptyListRemediation: 'Add list items or remove the list.',
    externalTraffic: 'The description may contain contact details or off-platform redirection',
    externalTrafficRemediation:
      'Review Alibaba.com content rules and remove off-platform contact details, payment methods, or outbound links.'
  }
} as const satisfies Record<UiLocale, Record<string, string>>;

type ProductQualityMessageKey = keyof (typeof PRODUCT_QUALITY_MESSAGES)['zh-CN'];

function qualityMessage(
  locale: UiLocale,
  key: ProductQualityMessageKey,
  values: Readonly<Record<string, string | number>> = {}
): string {
  return Object.entries(values).reduce<string>(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    PRODUCT_QUALITY_MESSAGES[locale][key]
  );
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
