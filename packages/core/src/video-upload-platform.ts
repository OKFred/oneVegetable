import type { AlibabaClient } from './alibaba-client';
import { VideoAdapter } from './video';
import type { VideoUploadPlatform } from './video-upload-service';
import { videoUploadFail } from './video-upload';

type Validator = (
  method: string,
  value: unknown
) => Promise<readonly { instancePath: string; keyword: string }[]>;
const METHOD = 'alibaba.icbu.video.upload';

/** Node and formal MV3 upload/readback accepted on 2026-09-23; Worker remains gated. */
const VIDEO_UPLOAD_VERIFIED_RUNTIMES: readonly string[] = Object.freeze(['node', 'extension']);

export function isVideoUploadRuntimeEnabled(input: {
  runtime: 'node' | 'cloudflare' | 'extension';
  environment: string;
  localAcceptance?: boolean;
  paused?: boolean;
}): boolean {
  if (input.paused || ['production', 'staging'].includes(input.environment)) return false;
  if (input.runtime === 'node' && input.environment === 'local-node' && input.localAcceptance) return true;
  if (!VIDEO_UPLOAD_VERIFIED_RUNTIMES.includes(input.runtime)) return false;
  return (
    (input.runtime === 'node' && input.environment === 'local-node') ||
    (input.runtime === 'cloudflare' && input.environment === 'self-hosted') ||
    (input.runtime === 'extension' && input.environment === 'extension')
  );
}

export function createVideoUploadPlatform(
  client: Pick<AlibabaClient, 'call'>,
  validateRequest: Validator,
  validateResponse: Validator
): VideoUploadPlatform {
  const videos = new VideoAdapter(client, validateRequest, validateResponse);
  return {
    async find(title) {
      const page = await videos.list({ page: 1, pageSize: 20, title });
      if (page.total === null || page.total > page.items.length) videoUploadFail('VIDEO_BASELINE_INCOMPLETE');
      return page.items.flatMap((video) => (video.id ? [{ id: video.id, title: video.title }] : []));
    },
    async upload(url, title) {
      const payload = { video_path: url, video_name: title };
      if ((await validateRequest(METHOD, payload)).length) videoUploadFail('REQUEST_CONTRACT_INVALID');
      const response = await client.call(METHOD, payload);
      const root = object(response.data);
      const data = object(root?.alibaba_icbu_video_upload_response) ?? root;
      if (!data || root?.error_response || (await validateResponse(METHOD, data)).length)
        videoUploadFail('VIDEO_UPLOAD_RESPONSE_INVALID');
      return {
        accepted: data.msg_code === '200',
        traceId: typeof data.request_id === 'string' ? data.request_id : (response.traceId ?? null)
      };
    }
  };
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
