// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { MockGatewayClient } from '../../core/src/mock-client';
import {
  requestVideo,
  VideoReadScope,
  mustStopVideoQueries,
  resolveVideoProductTarget
} from '../src/lib/video-library';
import { GatewayException } from '../../core/src/errors';
import { pageDetailIdentity } from '../src/lib/page-details';
describe('video read cache and cancellation', () => {
  it('only resolves a unique exact video with its encrypted ID; never invents an upload result', async () => {
    const gateway = new MockGatewayClient(0);
    const identity = await pageDetailIdentity(gateway, 'mock');
    const page = await gateway.request('listVideos', { page: 1, pageSize: 20 });
    const video = page.items[0];
    if (!video?.id) throw new Error('Missing fixture');
    const spy = vi.spyOn(gateway, 'request');
    const target = { videoId: video.id, identity };
    expect(await resolveVideoProductTarget(gateway, 'mock', 'en_US', target)).toEqual(video);
    await resolveVideoProductTarget(gateway, 'mock', 'en_US', target);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const items of [[], [video, video], [{ ...video, encryptedId: null }]]) {
      spy.mockResolvedValueOnce({ ...page, items });
      await expect(resolveVideoProductTarget(gateway, 'mock', 'en_US', target)).rejects.toThrow(
        'VIDEO_RESPONSE_INVALID'
      );
    }
    const calls = spy.mock.calls.length;
    await expect(
      resolveVideoProductTarget(gateway, 'mock', 'en_US', { ...target, videoId: 'invalid' })
    ).rejects.toThrow('VIDEO_RESPONSE_INVALID');
    expect(spy).toHaveBeenCalledTimes(calls);
  });
  it('stops on platform permission codes and credential subcodes without hiding per-item failures', () => {
    for (const [code, subCode] of [
      ['11', ''],
      ['50', 'isv.insufficient-isv-permissions'],
      ['50', 'isv.invalid-session']
    ]) {
      expect(
        mustStopVideoQueries(
          new GatewayException({
            code: code ?? '',
            subCode: subCode ?? '',
            message: 'Platform response',
            retryable: false
          })
        )
      ).toBe(true);
    }
    expect(mustStopVideoQueries(new Error('GALLERY_CONTEXT_CHANGED'))).toBe(true);
    expect(mustStopVideoQueries(new Error('VIDEO_RESPONSE_INVALID'))).toBe(false);
  });
  it('scopes memory cache by context, operation and API language and supports refresh', async () => {
    const gateway = new MockGatewayClient(0),
      spy = vi.spyOn(gateway, 'request');
    const identity = await pageDetailIdentity(gateway, 'mock');
    const payload = { page: 1, pageSize: 20 as const };
    await requestVideo(gateway, 'mock', 'en_US', 'listVideos', payload, identity);
    await requestVideo(gateway, 'mock', 'en_US', 'listVideos', payload, identity);
    expect(spy).toHaveBeenCalledTimes(1);
    await requestVideo(gateway, 'mock', 'zh_CN', 'listVideos', payload, identity);
    await requestVideo(gateway, 'mock', 'zh_CN', 'listVideos', payload, identity, true);
    expect(spy).toHaveBeenCalledTimes(3);
    await expect(
      requestVideo(gateway, 'mock', 'en_US', 'listVideos', payload, 'another-account')
    ).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    expect(spy).toHaveBeenCalledTimes(3);
  });
  it('expires after five minutes and refuses malformed responses', async () => {
    const gateway = new MockGatewayClient(0),
      spy = vi.spyOn(gateway, 'request');
    const identity = await pageDetailIdentity(gateway, 'mock');
    await requestVideo(gateway, 'mock', 'en_US', 'listVideos', { page: 1, pageSize: 20 }, identity);
    const time = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    await requestVideo(gateway, 'mock', 'en_US', 'listVideos', { page: 1, pageSize: 20 }, identity);
    expect(spy).toHaveBeenCalledTimes(2);
    time.mockRestore();
    spy.mockResolvedValueOnce({} as never);
    await expect(
      requestVideo(gateway, 'mock', 'en_US', 'listVideos', { page: 1, pageSize: 20 }, identity, true)
    ).rejects.toThrow('VIDEO_RESPONSE_INVALID');
  });
  it('invalidates delayed work without cancelling requests already issued', () => {
    const scope = new VideoReadScope(),
      current = scope.capture();
    expect(current()).toBe(true);
    scope.stop();
    expect(current()).toBe(false);
    expect(scope.capture()()).toBe(true);
  });
});
