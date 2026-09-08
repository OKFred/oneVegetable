import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/extension-s3.json';
import { ExtensionS3Service, type S3LocalStore } from '../lib/s3-service';
import {
  parseS3StorageConfiguration,
  s3PermissionOrigins,
  S3ObjectStorageClient
} from '@one-vegetable/core/s3-storage';
import { encodeBase64 } from '@one-vegetable/core';

const configuration = parseS3StorageConfiguration(fixture.configuration);
function setup() {
  let stored: unknown;
  let key: CryptoKey | null = null;
  const store: S3LocalStore = {
    read: () => Promise.resolve(stored),
    write: (value) => {
      stored = structuredClone(value);
      return Promise.resolve();
    },
    remove: () => {
      stored = undefined;
      return Promise.resolve();
    },
    key: async (create) => {
      if (!key && create)
        key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt'
        ]);
      return key;
    },
    removeKey: () => {
      key = null;
      return Promise.resolve();
    }
  };
  const contains = vi.fn(() => Promise.resolve(true));
  const send = vi.fn(() =>
    Promise.resolve(new Response(fixture.listXml, { headers: { 'content-type': 'application/xml' } }))
  );
  const create = () =>
    new ExtensionS3Service(store, contains, (config) => new S3ObjectStorageClient(config, { send }));
  const service = create();
  const call = (operation: string, payload: unknown = {}, trusted = true) =>
    service.handle(
      { kind: 's3-storage-request', requestId: crypto.randomUUID(), operation, payload },
      trusted
    );
  const save = () => call('save', { configuration, revision: null, remark: null });
  return {
    store,
    create,
    service,
    contains,
    send,
    call,
    save,
    corrupt: (value: unknown) => {
      stored = value;
    }
  };
}
describe('extension S3 isolated service', () => {
  it('encrypts configuration, redacts summaries, survives worker recreation, and clears the key', async () => {
    const s = setup();
    expect((await s.save()).ok).toBe(true);
    const serialized = JSON.stringify(await s.store.read());
    expect(serialized).not.toContain(configuration.secretAccessKey);
    expect(serialized).not.toContain(configuration.accessKeyId);
    expect((await s.store.key(false))?.extractable).toBe(false);
    const response = await s
      .create()
      .handle({ requestId: crypto.randomUUID(), operation: 'summary', payload: {} }, true);
    expect(response.data).toMatchObject({ configured: true, revision: 1, accessKeyIdSuffix: '-key' });
    expect(JSON.stringify(response)).not.toContain(configuration.secretAccessKey);
    expect((await s.call('clear', { revision: 1 })).ok).toBe(true);
    expect(await s.store.key(false)).toBe(null);
    expect(await s.store.read()).toBeUndefined();
  });
  it('denies untrusted senders and malformed requests before storage or network', async () => {
    const s = setup();
    expect((await s.call('save', { configuration, revision: null, remark: null }, false)).error?.code).toBe(
      'S3_UNTRUSTED_SENDER'
    );
    expect((await s.service.handle({ requestId: 'invalid' }, true)).error?.code).toBe('INVALID_REQUEST_ID');
    expect((await s.call('summary', { url: 'https://other.example' })).error?.code).toBe(
      'INVALID_REQUEST_BODY'
    );
    expect(await s.store.read()).toBeUndefined();
    expect(s.send).not.toHaveBeenCalled();
  });
  it('requires exact host grants on save and checks revocation before every network call', async () => {
    const s = setup();
    s.contains.mockResolvedValue(false);
    expect((await s.save()).error?.code).toBe('S3_PERMISSION_REQUIRED');
    s.contains.mockResolvedValue(true);
    await s.save();
    s.contains.mockResolvedValue(false);
    expect((await s.call('list')).error?.code).toBe('S3_PERMISSION_REQUIRED');
    expect(s.send).not.toHaveBeenCalled();
    expect(s3PermissionOrigins(configuration)).toEqual(['https://storage.example.com/*']);
    expect(s3PermissionOrigins({ ...configuration, pathStyle: false })).toEqual([
      'https://gallery.storage.example.com/*'
    ]);
  });
  it('serializes competing saves and rejects stale revisions', async () => {
    const s = setup();
    const results = await Promise.all([s.save(), s.save()]);
    expect(results.map((value) => value.ok)).toEqual([true, false]);
    expect(results[1].error?.code).toBe('ENTITY_VERSION_CONFLICT');
    expect((await s.call('clear', { revision: 2 })).error?.code).toBe('ENTITY_VERSION_CONFLICT');
  });
  it('rejects tampered ciphertext and metadata without leaking errors or secrets', async () => {
    const s = setup();
    await s.save();
    const stored = (await s.store.read()) as Record<string, unknown>;
    s.corrupt({ ...stored, revision: 2 });
    expect((await s.call('summary')).error?.code).toBe('S3_CONFIGURATION_CORRUPT');
    expect((await s.call('reset')).ok).toBe(true);
    expect(await s.store.key(false)).toBeNull();
  });
  it('signs list/get/put, bridges bytes via Base64, and never automatically retries a write', async () => {
    const s = setup();
    await s.save();
    expect((await s.call('list', { prefix: 'assets', maximum: 10 })).data).toMatchObject({
      items: [{ key: 'assets/photo.png' }]
    });
    s.send.mockResolvedValueOnce(
      new Response(new Uint8Array(fixture.bytes), { headers: { 'content-type': 'image/png' } })
    );
    expect((await s.call('get', { key: 'assets/photo.png' })).data).toMatchObject({
      contentBase64: 'AQIDBA==',
      byteLength: 4
    });
    s.send.mockRejectedValueOnce(new Error(`Authorization ${configuration.secretAccessKey}`));
    const result = await s.call('put', {
      key: 'assets/new.png',
      contentBase64: encodeBase64(new Uint8Array(fixture.bytes)),
      contentType: 'image/png'
    });
    expect(result.error?.code).toBe('S3_STORAGE_FAILED');
    expect(JSON.stringify(result)).not.toContain(configuration.secretAccessKey);
    expect(s.send).toHaveBeenCalledTimes(3);
  });
  it('rejects invalid Base64, oversized bytes and traversal before transport', async () => {
    const s = setup();
    await s.save();
    for (const contentBase64 of ['data:image/png;base64,AQIDBA==', '!invalid', 'A'.repeat(7_000_004)]) {
      expect(
        (await s.call('put', { key: 'assets/new.png', contentBase64, contentType: 'image/png' })).ok
      ).toBe(false);
    }
    expect((await s.call('get', { key: '../outside' })).ok).toBe(false);
    expect((await s.call('list', { maximum: -1 })).ok).toBe(false);
    expect(s.send).not.toHaveBeenCalled();
  });
});
