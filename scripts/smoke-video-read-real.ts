import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { GatewayException } from '../packages/core/src/errors';
import { atomicWriteJson } from './openapi-auth/storage';
import type { VideoListRequest } from '../packages/core/src/video';
if (process.env.ONE_VEGETABLE_VIDEO_SMOKE !== '1') throw new Error('Explicit read-only opt-in required');
const provider = createNodeAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: resolve(
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
  )
});
const gateway = new AlibabaReadGatewayClient(provider.requireCredentials(), { maxAttempts: 1 });
const reports: Record<string, unknown>[] = [];
const output = resolve(`artifacts/video-read-validation/${randomUUID()}.json`);
try {
  const requestId = randomUUID();
  const page = await gateway.request('listVideos', { page: 1, pageSize: 20 }, { requestId });
  reports.push({
    operation: 'listVideos',
    requestId,
    count: page.items.length,
    total: page.total,
    issues: page.issues,
    traceId: page.traceId,
    samples: page.items.slice(0, 3).map((v) => ({
      id: v.id,
      status: v.status,
      quality: v.quality,
      durationRaw: v.durationRaw,
      width: v.width,
      height: v.height,
      fileSize: v.fileSize,
      publishedAt: v.publishedAt,
      relatedProductCount: v.relatedProductCount,
      playbackOrigin: v.videoUrl ? new URL(v.videoUrl).origin : null
    }))
  });
  const first = page.items[0];
  const probes: { kind: string; request: VideoListRequest }[] = [
    { kind: 'page-two', request: { page: 2, pageSize: 20 } },
    { kind: 'page-size-50', request: { page: 1, pageSize: 50 } },
    ...(first?.id ? [{ kind: 'plain-id', request: { page: 1, pageSize: 20 as const, id: first.id } }] : []),
    ...(first?.title
      ? [{ kind: 'title', request: { page: 1, pageSize: 20 as const, title: first.title } }]
      : [])
  ];
  for (const probe of probes) {
    await setTimeout(350);
    const requestId = randomUUID();
    const result = await gateway.request('listVideos', probe.request, { requestId });
    const matched =
      probe.kind === 'plain-id'
        ? result.items.length > 0 && result.items.every((v) => v.id === first?.id)
        : probe.kind === 'title'
          ? result.items.some((v) => v.id === first?.id)
          : result.items.length > 0;
    reports.push({
      operation: 'listVideos',
      probe: probe.kind,
      requestId,
      count: result.items.length,
      matched,
      issues: result.issues,
      traceId: result.traceId
    });
    if (!matched) throw new Error('Search or pagination mismatch');
  }
  for (const video of page.items.slice(0, 3)) {
    if (!video.encryptedId) continue;
    for (const type of ['main', 'detail'] as const) {
      await setTimeout(350);
      const requestId = randomUUID();
      const r = await gateway.request(
        'listVideoRelatedProducts',
        { videoId: video.encryptedId, type },
        { requestId }
      );
      reports.push({
        operation: 'listVideoRelatedProducts',
        videoId: video.id,
        type,
        requestId,
        count: r.encryptedProductIds.length,
        issues: r.issues,
        traceId: r.traceId
      });
      for (const id of r.encryptedProductIds.slice(0, 1)) {
        await setTimeout(350);
        const requestId = randomUUID();
        const result = await gateway.request(
          'resolveVideoRelatedProduct',
          { encryptedProductId: id, language: 'en_US' },
          { requestId }
        );
        reports.push({
          operation: 'resolveVideoRelatedProduct',
          videoId: video.id,
          type,
          requestId,
          status: result.status,
          productId: result.productId,
          hasTitle: !!result.product?.subject,
          hasLink: !!result.product?.detailUrl,
          issues: result.issues,
          traceId: result.traceId
        });
      }
    }
  }
} catch (error: unknown) {
  const e = error instanceof GatewayException ? error.gatewayError : null;
  reports.push({ status: 'failed', code: e?.code ?? 'LOCAL_ERROR', subCode: e?.subCode ?? null });
  process.exitCode = 1;
} finally {
  await atomicWriteJson(output, { capturedAtUtc: new Date().toISOString(), readOnly: true, reports });
  console.log(JSON.stringify({ output, reports }));
}
