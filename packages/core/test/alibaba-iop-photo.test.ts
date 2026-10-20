import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/alibaba-auth/iop-photo-responses.json';
import { AlibabaClient, createAlibabaFileRequest } from '../src/alibaba-client';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT, signIopRequest } from '../src/alibaba-iop';
import { NetworkManager, type NetworkTransport } from '../src/network';
import { PhotoAdapter } from '../src/photo-adapter';
import { executeCapabilityCall } from '../src/capability-call';
import type { GatewayCredentials } from '../src/types';

const credentials: GatewayCredentials = {
  protocol: 'iop',
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  signMethod: 'hmac-sha256'
};
const file = {
  fieldName: 'image_bytes',
  fileName: 'fixture.png',
  contentType: 'image/png',
  bytes: new Uint8Array(fixture.bytes)
};

describe('IOP photobank transport and adapters', () => {
  const photoMethod = 'alibaba.icbu.photobank.list';
  const photoRequest = { group_id: '1001', location_type: 'SUB_GROUP', current_page: 1, page_size: 1 };
  const signedScope = { groupId: '1001', currentPage: '1', pageSize: '1' };
  function samplePhoto() {
    const row = fixture.scopedPhotos.result.pagination_query_list.list[0];
    if (!row) throw new Error('PHOTO_FIXTURE_MISSING');
    return { ...row };
  }
  function photoClient(response: unknown, protocol: 'iop' | 'top' = 'iop') {
    const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json(response));
    const selected =
      protocol === 'iop'
        ? credentials
        : { ...credentials, protocol, endpoint: 'https://eco.taobao.com/router/rest' };
    return {
      send,
      client: new AlibabaClient(
        selected,
        new NetworkManager({
          transport: { send },
          policies: { alibaba: { allowedOrigins: [new URL(selected.endpoint).origin] } }
        }),
        { maxAttempts: 3, shouldRetry: () => true }
      )
    };
  }
  it('accepts scoped data and keeps unknown totals rather than inventing completeness', async () => {
    const { client } = photoClient(fixture.scopedPhotos);
    await expect(
      new PhotoAdapter(client).list({ groupId: '1001', page: 1, pageSize: 1 })
    ).resolves.toMatchObject({
      total: null,
      hasNextPage: true,
      items: [{ id: '1002', groupId: '1001' }]
    });
    const result = structuredClone(fixture.scopedPhotos);
    result.result.pagination_query_list.list = [];
    await expect(
      new PhotoAdapter(photoClient(result).client).list({ groupId: '1001', page: 1, pageSize: 1 })
    ).resolves.toMatchObject({
      total: null,
      hasNextPage: false,
      items: []
    });
  });
  it.each(fixture.photoScopeCases)(
    'rejects $name without filtering into empty data, retry or TOP fallback',
    async ({ groupId }) => {
      const result = structuredClone(fixture.scopedPhotos);
      const first = result.result.pagination_query_list.list[0];
      if (!first) throw new Error('PHOTO_FIXTURE_MISSING');
      const row: Record<string, unknown> = first;
      if (groupId === undefined) Reflect.deleteProperty(row, 'group_id');
      else row.group_id = groupId;
      const { client, send } = photoClient(result);
      await expect(client.call(photoMethod, photoRequest)).rejects.toMatchObject({
        gatewayError: {
          code: 'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH',
          subCode: 'PHOTO_GROUP_MISMATCH',
          traceId: 'fixture-photo-scope-trace',
          retryable: false
        }
      });
      expect(send).toHaveBeenCalledOnce();
      const url = send.mock.calls[0]?.[0];
      expect(url instanceof URL ? url.href : typeof url === 'string' ? url : url?.url).toBe(
        IOP_BUSINESS_ENDPOINT + '/icbu/product/photobank/list'
      );
    }
  );
  it('checks mixed pages as a whole and refuses uncorrelated or overfull pagination', () => {
    const mixed = structuredClone(fixture.scopedPhotos);
    mixed.result.pagination_query_list.list.push({
      ...samplePhoto(),
      group_id: 2001
    });
    expect(() =>
      normalizeIopBusinessResponse(mixed, photoMethod, credentials, { ...signedScope, pageSize: '2' })
    ).toThrow('ALIBABA_IOP_PHOTO_SCOPE_MISMATCH');
    for (const metadata of [
      { current_page: 2 },
      { page_size: 2 },
      { current_page: true },
      { total: 0 },
      { total: -1 }
    ]) {
      const result = structuredClone(fixture.scopedPhotos);
      Object.assign(result.result.pagination_query_list, metadata);
      expect(() => normalizeIopBusinessResponse(result, photoMethod, credentials, signedScope)).toThrow(
        'ALIBABA_IOP_RESPONSE_INVALID'
      );
    }
    const overfull = structuredClone(fixture.scopedPhotos);
    overfull.result.pagination_query_list.list.push({
      ...samplePhoto(),
      id: 1003
    });
    expect(() => normalizeIopBusinessResponse(overfull, photoMethod, credentials, signedScope)).toThrow(
      'ALIBABA_IOP_RESPONSE_INVALID'
    );
    expect(() => normalizeIopBusinessResponse(fixture.scopedPhotos, photoMethod, credentials)).toThrow();
  });
  it('correlates to the actual signed request even if caller input changes during transport', async () => {
    const input = { ...photoRequest };
    const current = photoClient(fixture.scopedPhotos);
    current.send.mockImplementation(() => {
      input.group_id = '2001';
      return Promise.resolve(Response.json(fixture.scopedPhotos));
    });
    await expect(current.client.call(photoMethod, input)).resolves.toHaveProperty('data');
    expect(input.group_id).toBe('2001');
  });
  it('does not change TOP sub-group semantics', async () => {
    const data = { alibaba_icbu_photobank_list_response: fixture.scopedPhotos.result };
    const { client, send } = photoClient(data, 'top');
    await expect(client.call(photoMethod, { ...photoRequest, group_id: '2001' })).resolves.toMatchObject({
      data
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('propagates scope failures from the generic debugger without reporting contract-valid data', async () => {
    const wrong = structuredClone(fixture.scopedPhotos);
    wrong.result.pagination_query_list.list = [{ ...samplePhoto(), group_id: 2001 }];
    const { client, send } = photoClient(wrong);
    const validation = {
      validateCapabilityRequest: vi.fn().mockResolvedValue([]),
      validateCapabilityResponse: vi.fn().mockResolvedValue([])
    };
    await expect(
      executeCapabilityCall(client, { method: photoMethod, parameters: photoRequest }, validation)
    ).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH' }
    });
    expect(send).toHaveBeenCalledOnce();
    expect(validation.validateCapabilityResponse).not.toHaveBeenCalled();
  });
  it('accepts safe string identifiers but rejects an empty first page contradicting its total', () => {
    const strings = structuredClone(fixture.scopedPhotos);
    const first: Record<string, unknown> = samplePhoto();
    first.group_id = '1001';
    Object.assign(strings.result.pagination_query_list, { list: [first] });
    expect(() => normalizeIopBusinessResponse(strings, photoMethod, credentials, signedScope)).not.toThrow();
    Object.assign(strings.result.pagination_query_list, { list: [], total: 1 });
    expect(() => normalizeIopBusinessResponse(strings, photoMethod, credentials, signedScope)).toThrow(
      'ALIBABA_IOP_RESPONSE_INVALID'
    );
  });
  it('rejects explicit continuation metadata that would otherwise become a false-empty deletion proof', () => {
    const response = structuredClone(fixture.scopedPhotos);
    Object.assign(response.result.pagination_query_list, { list: [], total: 0, has_next_page: true });
    expect(() => normalizeIopBusinessResponse(response, photoMethod, credentials, signedScope)).toThrow(
      'ALIBABA_IOP_RESPONSE_INVALID'
    );
    Object.assign(response.result.pagination_query_list, { has_next_page: 'true' });
    expect(() => normalizeIopBusinessResponse(response, photoMethod, credentials, signedScope)).toThrow();
    Reflect.deleteProperty(response.result.pagination_query_list, 'total');
    expect(() => normalizeIopBusinessResponse(response, photoMethod, credentials, signedScope)).toThrow();
    Object.assign(response.result.pagination_query_list, { has_next_page: false });
    expect(() => normalizeIopBusinessResponse(response, photoMethod, credentials, signedScope)).not.toThrow();
  });
  it.each([credentials.appSecret, credentials.accessToken])(
    'does not preserve a credential echo as the provider trace',
    (secret) => {
      const wrong = structuredClone(fixture.scopedPhotos);
      wrong.result.pagination_query_list.list = [{ ...samplePhoto(), group_id: 2001 }];
      wrong.request_id = `prefix-${secret}-suffix`;
      let captured: unknown;
      try {
        normalizeIopBusinessResponse(wrong, photoMethod, credentials, signedScope);
      } catch (error) {
        captured = error;
      }
      expect(captured).toMatchObject({ gatewayError: { code: 'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH' } });
      expect(JSON.stringify(captured)).not.toContain(secret);
    }
  );
  it('uses an API-path signature over text fields and a separate binary multipart part', async () => {
    const request = await createAlibabaFileRequest(
      credentials,
      'alibaba.icbu.photobank.upload',
      { file_name: file.fileName, group_id: '1001' },
      file
    );
    expect(request.url).toBe(IOP_BUSINESS_ENDPOINT + '/alibaba/icbu/photobank/upload');
    const form = await new Response(request.body, {
      headers: { 'content-type': request.contentType }
    }).formData();
    const image = form.get('image_bytes');
    expect(image).toBeInstanceOf(File);
    expect(new Uint8Array(await (image as File).arrayBuffer())).toEqual(file.bytes);
    const parameters = Object.fromEntries([...form].filter(([key]) => key !== 'image_bytes')) as Record<
      string,
      string
    >;
    expect(parameters).toMatchObject({
      file_name: 'fixture.png',
      group_id: '1001',
      access_token: 'fixture-token',
      sign_method: 'sha256'
    });
    expect(parameters).not.toHaveProperty('session');
    expect(parameters).not.toHaveProperty('method');
    expect(parameters.sign).toBe(
      await signIopRequest('/alibaba/icbu/photobank/upload', parameters, credentials.appSecret)
    );
  });
  it('flattens group request objects without mixing parent coordinates and group IDs', async () => {
    const request = await createIopBusinessRequest(credentials, 'alibaba.icbu.photobank.group.operate', {
      photo_group_operation_request: { operation: 'add', group_id: 1001, group_name: 'Child' }
    });
    expect(request.parameters).toMatchObject({ operation: 'add', group_id: '1001', group_name: 'Child' });
    expect(request.parameters).not.toHaveProperty('photo_group_operation_request');
    const group = normalizeIopBusinessResponse(
      fixture.group,
      'alibaba.icbu.photobank.group.operate',
      credentials
    );
    const call = vi.fn().mockResolvedValue({ method: 'alibaba.icbu.photobank.group.operate', data: group });
    await expect(
      new PhotoAdapter({ call, callWithFile: vi.fn() }).operateGroup({
        operation: 'add',
        groupId: '1000',
        groupName: 'Child'
      })
    ).resolves.toMatchObject({ groupId: '1001', group: { parentId: '1000' } });
  });
  it('requires a reliable file identifier and URL, rather than treating code zero as upload success', async () => {
    const method = 'alibaba.icbu.photobank.upload';
    const normalized = normalizeIopBusinessResponse(fixture.upload, method, credentials);
    const callWithFile = vi.fn().mockResolvedValue({ method, data: normalized });
    await expect(
      new PhotoAdapter({ call: vi.fn(), callWithFile }).upload({
        fileName: file.fileName,
        groupId: '1001',
        contentType: 'image/png',
        byteLength: file.bytes.length,
        contentBase64: btoa(String.fromCharCode(...file.bytes))
      })
    ).resolves.toMatchObject({
      id: '1002',
      groupId: '1001',
      url: fixture.upload.result.response_object.photobank_url
    });
    for (const response_object of [
      {},
      { file_id: '1002' },
      { file_id: '9007199254740992', photobank_url: 'https://sc04.alicdn.com/kf/fixture.png' }
    ])
      expect(() =>
        normalizeIopBusinessResponse(
          { ...fixture.upload, result: { ...fixture.upload.result, response_object } },
          method,
          credentials
        )
      ).toThrow('ALIBABA_IOP_RESPONSE_INVALID');
  });
  it('dispatches an accepted IOP upload once and still blocks unverified group deletion', async () => {
    const send = vi.fn<NetworkTransport['send']>();
    send.mockResolvedValue(Response.json(fixture.upload));
    const client = new AlibabaClient(
      credentials,
      new NetworkManager({
        transport: { send },
        policies: { alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] } }
      }),
      { maxAttempts: 3 }
    );
    await expect(
      client.callWithFile('alibaba.icbu.photobank.upload', { file_name: 'fixture.png' }, file)
    ).resolves.toMatchObject({
      data: { alibaba_icbu_photobank_upload_response: { upload_image_response: { file_id: '1002' } } }
    });
    expect(send).toHaveBeenCalledOnce();
    send.mockClear();
    await expect(
      client.call('alibaba.icbu.photobank.group.operate', {
        photo_group_operation_request: { operation: 'delete', group_id: 1001 }
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_IOP_MUTATION_UNVERIFIED' } });
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects unsupported file fields and malformed group requests before dispatch', async () => {
    await expect(
      createAlibabaFileRequest(
        credentials,
        'alibaba.icbu.photobank.upload',
        {},
        { ...file, fieldName: 'other' }
      )
    ).rejects.toThrow();
    await expect(
      createIopBusinessRequest(credentials, 'alibaba.icbu.photobank.group.operate', {
        photo_group_operation_request: { operation: 'rename', group_name: 'Name' }
      })
    ).rejects.toThrow();
    await expect(
      createIopBusinessRequest(credentials, 'alibaba.icbu.photobank.group.operate', {
        photo_group_operation_request: { operation: 'add', group_name: 'Name', session: 'forbidden' }
      })
    ).rejects.toThrow();
  });
});
