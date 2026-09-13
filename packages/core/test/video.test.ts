import { describe, it, expect, vi } from 'vitest';
import fixture from '../../../mock/data/video/top.json';
import { adaptVideoPage, adaptVideoRelations, safeVideoId, safeVideoUrl, VideoAdapter } from '../src/video';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-validation-worker';
import { validateVideoPage, validateVideoRelations } from '../src/generated/validators-video';
const request = { page: 1, pageSize: 20 as const };
describe('read-only videos', () => {
  it('preserves raw units and separates plain/encrypted IDs, quality and review', () => {
    const page = adaptVideoPage(fixture.query, request);
    expect(validateVideoPage(page)).toBe(true);
    expect(page.items[0]).toMatchObject({
      id: '900001',
      encryptedId: 'encrypted-example',
      durationRaw: 14000,
      status: 'approved',
      quality: 'normal'
    });
    expect(page.traceId).toBe('mock-query');
  });
  it('uses method-specific success and never interprets absent data as empty', () => {
    expect(() => adaptVideoPage({ result: { msg_code: '0', model: { list: [] } } }, request)).toThrow();
    expect(() => adaptVideoPage({ result: { msg_code: '200', model: {} } }, request)).toThrow();
    const relation = { videoId: 'encrypted-example', type: 'main' as const };
    expect(validateVideoRelations(adaptVideoRelations(fixture.relations, relation))).toBe(true);
    expect(() => adaptVideoRelations({ result: { msg_code: '200', model: [] } }, relation)).toThrow();
    expect(
      adaptVideoRelations({ result: { msg_code: '0', model: [] } }, relation).encryptedProductIds
    ).toEqual([]);
  });
  it('rejects unsafe media and numeric precision loss', () => {
    for (const url of [
      'http://cloud.video.taobao.com/a',
      'https://cloud.video.taobao.com.evil.test/a',
      'javascript:alert(1)',
      'https://user:pass@cloud.video.taobao.com/a',
      'https://127.0.0.1/a'
    ])
      expect(safeVideoUrl(url)).toBeNull();
    expect(safeVideoUrl('//cloud.video.taobao.com/a')).toBe('https://cloud.video.taobao.com/a');
    expect(safeVideoId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(safeVideoId('9007199254740993')).toBeNull();
  });
  it('validates both methods and refuses invalid requests before network', async () => {
    const call = vi.fn().mockResolvedValue({ data: fixture.query });
    const adapter = new VideoAdapter({ call }, validateCapabilityRequest, validateCapabilityResponse);
    await expect(adapter.list({ ...request, id: 'encrypted' })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
    const page = await adapter.list(request);
    expect(page.issues).toEqual([]);
    expect(call).toHaveBeenCalledExactlyOnceWith('alibaba.icbu.video.query', {
      current_page: 1,
      page_size: 20
    });
    call.mockResolvedValue({ data: fixture.relations });
    const result = await adapter.related({ videoId: 'encrypted-example', type: 'detail' });
    expect(result.issues).toEqual([]);
    expect(call).toHaveBeenLastCalledWith('alibaba.icbu.video.relation.product.list', {
      video_id: 'encrypted-example',
      type: 'detailVideoId'
    });
  });
  it('uses exact product query after decrypt and enforces request spacing', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ data: fixture.decrypt })
      .mockResolvedValueOnce({ method: 'alibaba.icbu.product.list', data: { products: [], total: 0 } });
    const wait = vi.fn().mockResolvedValue(undefined);
    const result = await new VideoAdapter(
      { call },
      validateCapabilityRequest,
      validateCapabilityResponse,
      wait
    ).resolve({ encryptedProductId: 'encrypted-product', language: 'en_US' });
    expect(result.status).toBe('not-found');
    expect(wait).toHaveBeenCalledWith(300);
    expect(call.mock.calls[1]?.[0]).toBe('alibaba.icbu.product.list');
    expect(call.mock.calls[1]?.[1]).toMatchObject({ id: 900003, current_page: 1, page_size: 1 });
  });
});
