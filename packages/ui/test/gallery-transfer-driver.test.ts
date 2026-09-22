import { describe, expect, it, vi } from 'vitest';
import {
  allGalleryPhotos,
  BrowserGalleryTransferDriver,
  checkGalleryZipSize
} from '../src/lib/gallery-transfer-driver';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import fixture from '../../../mock/data/photos.json';
import taskFixture from '../../../mock/data/gallery-transfer-task.json';
import { validateGalleryTransferTask } from '@one-vegetable/core/gallery-transfer-task';
import type { AppServices } from '../src/lib/services';

function setup() {
  const gateway = new MockGatewayClient(0);
  const services: AppServices = {
    gateway,
    mode: 'mock',
    settings: {
      load: () => Promise.reject(new Error('unused')),
      save: () => Promise.reject(new Error('unused'))
    }
  };
  return { gateway, driver: new BrowserGalleryTransferDriver(services, () => undefined) };
}
describe('gallery transfer readback', () => {
  it('bounds cumulative ZIP bytes, including already-confirmed items after reload', () => {
    const task = validateGalleryTransferTask(structuredClone(taskFixture));
    task.direction = 'export';
    task.storage = 'zip';
    const first = task.items[0];
    if (!first) throw new Error('fixture');
    first.status = 'confirmed';
    first.sourceSize = 100 * 1024 * 1024;
    expect(() => {
      checkGalleryZipSize(task, 'next-item', 1);
    }).toThrow('GALLERY_TASK_ARCHIVE_LIMIT');
    expect(() => {
      checkGalleryZipSize(task, first.id, first.sourceSize ?? 0);
    }).not.toThrow();
    task.storage = 's3';
    expect(() => {
      checkGalleryZipSize(task, 'next-item', 1);
    }).not.toThrow();
  });
  it('finds uploaded file IDs beyond the first 100 entries', async () => {
    const s = setup();
    const photo = fixture.responses.listPhotos.items[0];
    if (!photo) throw new Error('fixture');
    const photos = Array.from({ length: 205 }, (_, index) => ({
      ...photo,
      id: `p-${index}`,
      groupId: '2001'
    }));
    const original = s.gateway.request.bind(s.gateway);
    vi.spyOn(s.gateway, 'request').mockImplementation(async (operation, payload) => {
      if (operation !== 'listPhotos') return original(operation, payload);
      const result = await original('listPhotos', { page: 1, pageSize: 100, groupId: '2001' });
      const page =
        typeof payload === 'object' && 'page' in payload && typeof payload.page === 'number'
          ? payload.page
          : 1;
      return {
        ...result,
        items: photos.slice((page - 1) * 100, page * 100),
        total: photos.length,
        page,
        pageSize: 100
      };
    });
    expect(await allGalleryPhotos(s.gateway, '2001')).toHaveLength(205);
  });
  it('never treats equal names without a fileId as a successful upload', async () => {
    const s = setup();
    const task = validateGalleryTransferTask(structuredClone(taskFixture));
    const item = task.items[0];
    if (!item) throw new Error('fixture');
    item.status = 'unknown';
    item.fileId = null;
    const send = vi.spyOn(s.gateway, 'request');
    expect((await s.driver.verify(task, item)).status).toBe('unknown');
    expect(send).not.toHaveBeenCalled();
  });

  it('walks unknown totals to an explicit last page instead of stopping at page one', async () => {
    const { gateway } = setup();
    const original = gateway.request.bind(gateway);
    const photo = fixture.responses.listPhotos.items[0];
    if (!photo) throw new Error('fixture');
    const photos = Array.from({ length: 101 }, (_, index) => ({ ...photo, id: `unknown-total-${index}` }));
    const request = vi.spyOn(gateway, 'request').mockImplementation(async (operation, payload) => {
      if (operation !== 'listPhotos') return original(operation, payload);
      const page =
        typeof payload === 'object' && 'page' in payload && typeof payload.page === 'number'
          ? payload.page
          : 1;
      return {
        ...(await original('listPhotos', { page: 1, pageSize: 100 })),
        page,
        pageSize: 100,
        total: null,
        hasNextPage: page === 1,
        items: photos.slice((page - 1) * 100, page * 100)
      };
    });
    expect(await allGalleryPhotos(gateway, '2001')).toHaveLength(101);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('refuses unknown totals with no completeness signal or repeated pages', async () => {
    const { gateway } = setup();
    const original = await gateway.request('listPhotos', { page: 1, pageSize: 100 });
    const request = vi.spyOn(gateway, 'request').mockResolvedValue({ ...original, total: null });
    await expect(allGalleryPhotos(gateway, '2001')).rejects.toThrow('GALLERY_TASK_PAGINATION');
    request.mockImplementation((_operation, payload) => {
      const page =
        typeof payload === 'object' && 'page' in payload && typeof payload.page === 'number'
          ? payload.page
          : 1;
      return Promise.resolve({ ...original, total: null, hasNextPage: true, page });
    });
    await expect(allGalleryPhotos(gateway, '2001')).rejects.toThrow('GALLERY_TASK_PAGINATION');
  });
  it('does not accept a different ZIP as the source for resume', async () => {
    const s = setup();
    const task = validateGalleryTransferTask(structuredClone(taskFixture));
    await expect(s.driver.attachArchive(task, new Uint8Array([0]))).rejects.toThrow(
      'GALLERY_TASK_ARCHIVE_CHANGED'
    );
  });
});
