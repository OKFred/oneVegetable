import { describe, expect, it, vi } from 'vitest';

import type { AlibabaClient } from '../src/alibaba-client';
import { PhotoAdapter } from '../src/photo-adapter';

function response(method: string, body: Record<string, unknown>) {
  return {
    method,
    data: { [`${method.replaceAll('.', '_')}_response`]: body }
  };
}

function client(
  call: AlibabaClient['call'],
  callWithFile: AlibabaClient['callWithFile'] = vi.fn<AlibabaClient['callWithFile']>()
): Pick<AlibabaClient, 'call' | 'callWithFile'> {
  return { call, callWithFile };
}

describe('PhotoAdapter', () => {
  it('normalizes nested official groups and derives hierarchy metadata', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          groups: {
            photo_album_group: [
              { id: 100, level1: 100, level2: 0, level3: 0, name: '商品主图' },
              { id: 101, level1: 100, level2: 101, level3: 0, name: '白底图' }
            ]
          }
        })
      )
    );

    await expect(new PhotoAdapter(client(call)).listGroups('100')).resolves.toEqual([
      { id: '100', name: '商品主图', photoCount: 0, parentId: null, level: 1 },
      { id: '101', name: '白底图', photoCount: 0, parentId: '100', level: 2 }
    ]);
    expect(call).toHaveBeenCalledWith('alibaba.icbu.photobank.group.list', { id: 100 });
  });

  it('uses explicit ALL_GROUP and SUB_GROUP list semantics', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(response(method, { pagination_query_list: { list: [], total: 0 } }))
    );
    const adapter = new PhotoAdapter(client(call));

    await adapter.list({ page: 2, pageSize: 12, groupId: '2001' });
    expect(call).toHaveBeenCalledWith('alibaba.icbu.photobank.list', {
      current_page: 2,
      page_size: 12,
      location_type: 'SUB_GROUP',
      group_id: '2001'
    });
  });

  it('keeps the returned gallery fileId and upgrades the URL to HTTPS', async () => {
    const call = vi.fn<AlibabaClient['call']>();
    const callWithFile = vi.fn<AlibabaClient['callWithFile']>((method) =>
      Promise.resolve(
        response(method, {
          upload_image_response: {
            file_id: 73826382,
            file_name: 'solar.jpg',
            photobank_url: 'http://g03.s.alicdn.com/kf/solar.jpg'
          }
        })
      )
    );

    await expect(
      new PhotoAdapter(client(call, callWithFile)).upload({
        contentBase64: '/9j/2Q==',
        contentType: 'image/jpeg',
        byteLength: 4,
        fileName: 'solar.jpg',
        groupId: '2001'
      })
    ).resolves.toMatchObject({
      id: '73826382',
      name: 'solar.jpg',
      url: 'https://g03.s.alicdn.com/kf/solar.jpg',
      groupId: '2001'
    });
    expect(call).not.toHaveBeenCalled();
    expect(callWithFile).toHaveBeenCalledOnce();
    const [method, parameters, file] = callWithFile.mock.calls[0] ?? [];
    expect(method).toBe('alibaba.icbu.photobank.upload');
    expect(parameters).toEqual({ file_name: 'solar.jpg', group_id: '2001' });
    expect(file).toMatchObject({
      fieldName: 'image_bytes',
      fileName: 'solar.jpg',
      contentType: 'image/jpeg'
    });
    expect(file?.bytes).toBeInstanceOf(Uint8Array);
  });

  it('does not fabricate dimensions that photobank.list did not return', async () => {
    const call = vi.fn<AlibabaClient['call']>((method) =>
      Promise.resolve(
        response(method, {
          pagination_query_list: {
            list: [
              {
                id: 'ph_real_1',
                file_name: 'real-photo.jpg',
                file_size: 1024,
                url: '//g03.s.alicdn.com/kf/real-photo.jpg'
              }
            ],
            total: 1
          }
        })
      )
    );

    await expect(
      new PhotoAdapter(client(call)).list({ page: 1, pageSize: 10, groupId: '-1' })
    ).resolves.toMatchObject({
      items: [
        {
          id: 'ph_real_1',
          width: null,
          height: null,
          url: 'https://g03.s.alicdn.com/kf/real-photo.jpg'
        }
      ]
    });
  });

  it('rejects an incomplete group mutation before sending it', async () => {
    const call = vi.fn<AlibabaClient['call']>();
    const adapter = new PhotoAdapter(client(call));

    await expect(
      adapter.operateGroup({ operation: 'rename', groupId: null, groupName: '新名称' })
    ).rejects.toThrow('groupId');
    expect(call).not.toHaveBeenCalled();
  });
});
