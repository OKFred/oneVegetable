import { describe, it, expect } from 'vitest';
import { createDocumentationReplayGateway } from '../src/gateway/documentation-replay';
import {
  validateVideoPage,
  validateVideoRelations
} from '../../../packages/core/src/generated/validators-video';
import { validateVideoAssociationResult } from '../../../packages/core/src/generated/validators-video-association';
describe('workerd video read-only replay', () => {
  it('keeps writes closed and validates a bounded readback failure without a write', async () => {
    const gateway = createDocumentationReplayGateway({ wait: () => Promise.resolve() });
    const request = {
      productId: '900003',
      videoId: '900001',
      encryptedVideoId: 'example-encrypted-video',
      type: 'main' as const,
      language: 'en_US' as const
    };
    await expect(gateway.request('associateProductVideo', { ...request, confirmed: true })).rejects.toThrow(
      'REAL_MUTATION_DISABLED'
    );
    const verification = await gateway.request('verifyProductVideoAssociation', request);
    expect(validateVideoAssociationResult(verification)).toBe(true);
    expect(verification.outcome).toBe('unconfirmed');
  });
  it('runs standalone validation, signing and both public read methods without real network', async () => {
    const gateway = createDocumentationReplayGateway();
    const list = await gateway.request('listVideos', { page: 1, pageSize: 20 });
    expect(validateVideoPage(list)).toBe(true);
    const related = await gateway.request('listVideoRelatedProducts', {
      videoId: 'example-encrypted-video',
      type: 'main'
    });
    expect(validateVideoRelations(related)).toBe(true);
  });
  it('does not retry a video read on a replay transport error', async () => {
    await expect(
      createDocumentationReplayGateway({ fault: 'rate-limit-once' }).request('listVideos', {
        page: 1,
        pageSize: 20
      })
    ).rejects.toThrow();
    await expect(
      createDocumentationReplayGateway({ fault: 'rate-limit-once' }).request('callCapability', {
        method: 'alibaba.icbu.video.query',
        parameters: { current_page: 1, page_size: 20 }
      })
    ).rejects.toThrow();
  });
});
