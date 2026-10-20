import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/alibaba-auth/iop-photo-responses.json';
import { AlibabaClient, createAlibabaFileRequest } from '../src/alibaba-client';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT, signIopRequest } from '../src/alibaba-iop';
import { NetworkManager, type NetworkTransport } from '../src/network';
import { PhotoAdapter } from '../src/photo-adapter';
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
