import type { AlibabaClient } from './alibaba-client';
import type {
  Video,
  VideoListRequest,
  VideoRelationRequest,
  VideoProductRequest,
  VideoPage,
  VideoRelations,
  VideoProductResolution
} from './types';
import { ProductAdapter } from './product-adapter';
import { productListLanguage } from './preferences';
import { GatewayException } from './errors';
import { findCapability } from './capability-registry';
import {
  validateVideoListRequest,
  validateVideoRelationRequest,
  validateVideoProductRequest
} from './generated/validators-video';
export type {
  Video,
  VideoListRequest,
  VideoRelationRequest,
  VideoProductRequest,
  VideoPage,
  VideoRelations,
  VideoProductResolution
} from './types';
export const VIDEO_LIBRARY_URL = 'https://us-productposting.alibaba.com/product/videobank/home.htm';
export const VIDEO_METHODS = [
  'alibaba.icbu.video.query',
  'alibaba.icbu.video.relation.product.list'
] as const;
export {
  validateVideoPage,
  validateVideoRelations,
  validateVideoProductResolution
} from './generated/validators-video';
export const VIDEO_OPERATIONS = [
  'listVideos',
  'listVideoRelatedProducts',
  'resolveVideoRelatedProduct'
] as const;
type Validator = (
  method: string,
  value: unknown
) => Promise<readonly { instancePath: string; keyword: string }[]>;
const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim().length ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
export function safeVideoId(v: unknown): string | null {
  if (typeof v === 'string' && /^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v))) return v;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
}
/** Metadata/media URLs only. Never forwards gateway credentials or proxies media. */
export function safeVideoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return null;
    const host = u.hostname.toLowerCase();
    return host === 'cloud.video.taobao.com' ||
      host === 'alicdn.com' ||
      host.endsWith('.alicdn.com') ||
      host === 'alibaba.com' ||
      host.endsWith('.alibaba.com')
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function safePlaybackUrl(raw: unknown): string | null {
  const value = safeVideoUrl(raw);
  return value && ['cloud.video.taobao.com', 'play.video.alibaba.com'].includes(new URL(value).hostname)
    ? value
    : null;
}
function fail(code: string): never {
  throw new GatewayException({ code, message: code, retryable: false });
}
function rawRoot(data: unknown, method: string): Record<string, unknown> {
  const root = rec(data);
  return rec(root?.[`${method.replaceAll('.', '_')}_response`]) ?? root ?? {};
}
function items(raw: unknown, wrapper: string): unknown[] | null {
  if (Array.isArray(raw)) return raw as unknown[];
  const wrapped = rec(raw)?.[wrapper];
  return Array.isArray(wrapped) ? wrapped : null;
}
export function adaptVideoPage(
  data: unknown,
  request: VideoListRequest,
  issues: string[] = [],
  now = Date.now()
): VideoPage {
  const root = rawRoot(data, 'alibaba.icbu.video.query'),
    result = rec(root.result),
    model = rec(result?.model);
  if (root.success === false || root.biz_success === false || result?.success === false)
    fail('VIDEO_PROVIDER_REJECTED');
  if (result?.msg_code !== undefined && result.msg_code !== '200') fail('VIDEO_PROVIDER_REJECTED');
  if (result?.msg_code === undefined) {
    if (
      !model ||
      num(model.current_page) === null ||
      num(model.page_size) === null ||
      num(model.total_count) === null
    )
      fail('VIDEO_RESPONSE_INVALID');
    issues.push('result/msg_code:not-returned');
  }
  const list = items(model?.list, 'isv_video_dto');
  if (!list) fail('VIDEO_RESPONSE_INVALID');
  const videos: Video[] = list.map((v, index) => {
    const row = rec(v);
    if (!row) fail('VIDEO_RESPONSE_INVALID');
    const id = safeVideoId(row.id),
      encryptedId = text(row.video_id);
    if (!id || !encryptedId) issues.push(`items/${index}:invalid-id`);
    const videoUrl = safePlaybackUrl(row.video_url),
      coverUrl = safeVideoUrl(row.cover_url);
    if (row.video_url && !videoUrl) issues.push(`items/${index}/videoUrl:unsafe-url`);
    return {
      id,
      encryptedId,
      title: text(row.title),
      videoUrl,
      coverUrl,
      width: num(row.video_width),
      height: num(row.video_height),
      fileSize: num(row.file_size),
      durationRaw: num(row.duration),
      publishedAt: num(row.publish_time),
      status: text(row.status),
      quality: text(row.quality),
      relatedProductCount: num(row.related_product_count),
      publisher: redactPublisher(row.publish_user_name)
    };
  });
  const total = num(model?.total_count);
  if (total === null || !Number.isSafeInteger(total)) issues.push('total:missing-or-invalid');
  return {
    items: videos,
    page: request.page,
    pageSize: request.pageSize,
    total: total !== null && Number.isSafeInteger(total) ? total : null,
    traceId: text(root.request_id) ?? '',
    queriedAt: now,
    issues
  };
}
export function adaptVideoRelations(
  data: unknown,
  request: VideoRelationRequest,
  issues: string[] = [],
  now = Date.now()
): VideoRelations {
  const root = rawRoot(data, 'alibaba.icbu.video.relation.product.list'),
    result = rec(root.result);
  if (root.success === false || root.biz_success === false || result?.success === false)
    fail('VIDEO_PROVIDER_REJECTED');
  if (result?.msg_code !== undefined && result.msg_code !== '0') fail('VIDEO_PROVIDER_REJECTED');
  const list = items(result?.model, 'isv_product_dto');
  if (!list) fail('VIDEO_RESPONSE_INVALID');
  if (result?.msg_code === undefined) issues.push('result/msg_code:not-returned');
  const ids = list.flatMap((row, index) => {
    const id = text(rec(row)?.product_id);
    if (!id) issues.push(`items/${index}:missing-product-id`);
    return id ? [id] : [];
  });
  if (list.length && !ids.length) fail('VIDEO_RESPONSE_INVALID');
  return {
    ...request,
    encryptedProductIds: [...new Set(ids)],
    traceId: text(root.request_id) ?? '',
    queriedAt: now,
    issues
  };
}
export class VideoAdapter {
  constructor(
    private readonly client: Pick<AlibabaClient, 'call'>,
    private readonly validateRequest: Validator,
    private readonly validateResponse: Validator,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}
  private async call(method: string, payload: Record<string, unknown>) {
    const capability = findCapability(method);
    if (
      !capability?.enabled ||
      capability.lifecycle !== 'active' ||
      capability.restricted ||
      !capability.realCallEnabled ||
      capability.risk !== 'read'
    )
      fail('CAPABILITY_RESTRICTED');
    if ((await this.validateRequest(method, payload)).length) fail('REQUEST_CONTRACT_INVALID');
    const response = await this.client.call(method, payload);
    const root = rawRoot(response.data, method);
    const issues = (await this.validateResponse(method, root)).map((i) => `${i.instancePath}:${i.keyword}`);
    return {
      root,
      issues,
      traceId: response.traceId ?? text(root.request_id) ?? text(rec(root.result)?.trace_id) ?? ''
    };
  }
  async list(request: VideoListRequest): Promise<VideoPage> {
    if (!validateVideoListRequest(request) || (request.id && !safeVideoId(request.id)))
      fail('REQUEST_CONTRACT_INVALID');
    const result = await this.call('alibaba.icbu.video.query', {
      current_page: request.page,
      page_size: request.pageSize,
      ...(request.title ? { title: request.title } : {}),
      ...(request.id ? { id: Number(request.id) } : {})
    });
    return { ...adaptVideoPage(result.root, request, result.issues), traceId: result.traceId };
  }
  async related(request: VideoRelationRequest): Promise<VideoRelations> {
    if (!validateVideoRelationRequest(request)) fail('REQUEST_CONTRACT_INVALID');
    const result = await this.call('alibaba.icbu.video.relation.product.list', {
      video_id: request.videoId,
      type: request.type === 'main' ? 'videoId' : 'detailVideoId'
    });
    return { ...adaptVideoRelations(result.root, request, result.issues), traceId: result.traceId };
  }
  async resolve(request: VideoProductRequest): Promise<VideoProductResolution> {
    if (!validateVideoProductRequest(request)) fail('REQUEST_CONTRACT_INVALID');
    const result = await this.call('alibaba.icbu.product.id.decrypt', {
      product_id: request.encryptedProductId,
      language: productListLanguage(request.language)
    });
    const productId = safeVideoId(result.root.id);
    const base = {
      encryptedProductId: request.encryptedProductId,
      productId,
      traceId: result.traceId,
      queriedAt: Date.now(),
      issues: result.issues
    };
    if (!productId) return { ...base, product: null, status: 'invalid-id' };
    await this.wait(300);
    const p = await new ProductAdapter({
      call: async (method, parameters) => {
        const summary = await this.call(method, { ...parameters });
        result.issues.push(...summary.issues);
        return { method, data: summary.root };
      }
    }).getSummary(productId, request.language);
    return {
      ...base,
      product: p
        ? {
            id: p.id,
            subject: p.subject,
            imageUrl: safeVideoUrl(p.imageUrl),
            detailUrl: p.detailUrl ?? null,
            status: p.status
          }
        : null,
      status: p ? 'resolved' : 'not-found'
    };
  }
}
function redactPublisher(value: unknown): string | null {
  const name = text(value);
  if (!name) return null;
  return name.includes('*') ? name : `${name.charAt(0)}***`;
}
