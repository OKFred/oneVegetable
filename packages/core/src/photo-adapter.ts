import type { AlibabaClient } from './alibaba-client';
import { MAX_PHOTOBANK_IMAGE_BYTES, PHOTO_CONTENT_TYPES, validateEncodedFile } from './encoded-file';
import type {
  Photo,
  PhotoGroup,
  PhotoGroupOperationResult,
  PhotoGroupOperationRequest,
  PhotoPage,
  PhotoUploadRequest,
  RequestOf
} from './types';

export class PhotoAdapter {
  constructor(private readonly client: Pick<AlibabaClient, 'call' | 'callWithFile'>) {}

  async listGroups(parentId?: string): Promise<PhotoGroup[]> {
    const call = await this.client.call('alibaba.icbu.photobank.group.list', {
      ...(parentId && parentId !== '-1' ? { id: numericOrString(parentId) } : {})
    });
    return findRecords(unwrap(call.data, call.method), ['photo_album_group']).map(normalizeGroup);
  }

  async operateGroup(request: PhotoGroupOperationRequest): Promise<PhotoGroupOperationResult> {
    assertGroupOperation(request);
    const call = await this.client.call('alibaba.icbu.photobank.group.operate', {
      photo_group_operation_request: {
        operation: request.operation,
        ...(request.groupId ? { group_id: numericOrString(request.groupId) } : {}),
        ...(request.groupName ? { group_name: request.groupName.trim() } : {})
      }
    });
    const root = unwrap(call.data, call.method);
    const record = findRecord(root, ['photobank_group']);
    if (request.operation === 'delete') {
      return {
        operation: request.operation,
        groupId: request.groupId ?? '',
        group: record ? normalizeGroup(record) : null
      };
    }
    if (!record) throw new Error('图库分组操作未返回分组信息');
    const group = normalizeGroup(record);
    return { operation: request.operation, groupId: group.id, group };
  }

  async list(request: RequestOf<'listPhotos'>): Promise<PhotoPage> {
    const page = positiveInteger(request.page, 1);
    const pageSize = Math.min(positiveInteger(request.pageSize, 24), 100);
    const groupId = request.groupId ?? '-1';
    const call = await this.client.call('alibaba.icbu.photobank.list', {
      current_page: page,
      page_size: pageSize,
      location_type: groupId === '-1' ? 'ALL_GROUP' : 'SUB_GROUP',
      ...(groupId !== '-1' ? { group_id: groupId } : {})
    });
    const root = unwrap(call.data, call.method);
    const items = findRecords(root, ['list', 'photobank_image_do', 'images']).map(normalizePhoto);
    return {
      items,
      page,
      pageSize,
      total: readInteger(findRecord(root, ['pagination_query_list']) ?? root, ['total']) ?? items.length
    };
  }

  async upload(request: PhotoUploadRequest): Promise<Photo> {
    const bytes = validateEncodedFile(request, {
      allowedContentTypes: PHOTO_CONTENT_TYPES,
      maxBytes: MAX_PHOTOBANK_IMAGE_BYTES,
      requireImageSignature: true
    });
    const fileName = request.fileName.trim();
    const call = await this.client.callWithFile(
      'alibaba.icbu.photobank.upload',
      {
        file_name: fileName,
        ...(request.groupId && request.groupId !== '-1' ? { group_id: request.groupId } : {})
      },
      {
        fieldName: 'image_bytes',
        fileName,
        contentType: request.contentType,
        bytes
      }
    );
    const root = findRecord(unwrap(call.data, call.method), ['upload_image_response']);
    if (!root) throw new Error('图库上传未返回素材信息');
    return {
      id: readString(root, ['file_id', 'id']) ?? '',
      name: readString(root, ['file_name']) ?? fileName,
      url: normalizeUrl(readString(root, ['photobank_url', 'url'])),
      groupId: request.groupId ?? '-1',
      width: readInteger(root, ['width']) ?? null,
      height: readInteger(root, ['height']) ?? null,
      fileSize: readInteger(root, ['file_size']) ?? bytes.byteLength,
      referenceCount: 0,
      modifiedAt: new Date().toISOString()
    };
  }
}

function assertGroupOperation(request: PhotoGroupOperationRequest): void {
  if (request.operation !== 'add' && !request.groupId) {
    throw new Error('重命名或删除分组时必须提供 groupId');
  }
  if (request.operation !== 'delete' && !request.groupName?.trim()) {
    throw new Error('新增或重命名分组时必须提供 groupName');
  }
}

function normalizeGroup(record: Record<string, unknown>): PhotoGroup {
  const id = readString(record, ['id', 'group_id']) ?? '';
  const levels = [
    readString(record, ['level1']),
    readString(record, ['level2']),
    readString(record, ['level3'])
  ];
  const level = Math.max(
    1,
    levels.reduce((count, value) => (value && value !== '0' ? count + 1 : count), 0)
  );
  const parentId = level > 1 ? (levels[level - 2] ?? null) : null;
  return {
    id,
    name: readString(record, ['name', 'group_name']) ?? '未命名分组',
    photoCount: readInteger(record, ['photo_count', 'count']) ?? 0,
    parentId: parentId === id ? null : parentId,
    level: Math.min(level, 3)
  };
}

function normalizePhoto(record: Record<string, unknown>): Photo {
  return {
    id: readString(record, ['id', 'photo_id']) ?? '',
    name: readString(record, ['display_name', 'file_name', 'name']) ?? '图片',
    url: normalizeUrl(readString(record, ['url', 'photobank_url'])),
    groupId: readString(record, ['group_id']) ?? '-1',
    width: readInteger(record, ['width']) ?? null,
    height: readInteger(record, ['height']) ?? null,
    fileSize: readInteger(record, ['file_size']) ?? 0,
    referenceCount: readInteger(record, ['reference_count']) ?? 0,
    modifiedAt: normalizeDate(readString(record, ['gmt_modified', 'modified_at']))
  };
}

function unwrap(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  const wrapped = record[`${method.replaceAll('.', '_')}_response`];
  return isRecord(wrapped) ? wrapped : record;
}

function findRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    if (isRecord(record[key])) return record[key];
  }
  for (const child of Object.values(record)) {
    if (!isRecord(child)) continue;
    const found = findRecord(child, keys);
    if (found) return found;
  }
  return null;
}

function findRecords(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  const visit = (value: unknown, depth: number): Record<string, unknown>[] | null => {
    if (depth > 6) return null;
    if (Array.isArray(value)) return value.filter(isRecord);
    if (!isRecord(value)) return null;
    for (const key of keys) {
      if (key in value) {
        const found = visit(value[key], depth + 1);
        if (found) return found;
      }
    }
    for (const child of Object.values(value)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(record, 0) ?? [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readInteger(record: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readString(record, keys);
  if (value !== undefined && Number.isInteger(Number(value))) return Number(value);
  return undefined;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? (value ?? fallback) : fallback;
}

function numericOrString(value: string): number | string {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : value;
}

function normalizeUrl(value: string | undefined): string {
  if (!value) return 'https://invalid.local/missing-photo';
  const absolute = value.startsWith('//') ? `https:${value}` : value;
  return absolute.replace(/^http:\/\//i, 'https://');
}

function normalizeDate(value: string | undefined): string {
  if (!value) return new Date(0).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
