import type {
  ExtensionSocialDevice,
  ExtensionSocialPairingStart,
  ExtensionSocialPairingStatus
} from '@one-vegetable/core';
import {
  publicDevice,
  type ExtensionSocialDeviceRecord,
  type ExtensionSocialDeviceRepository
} from './extension-device-repository';

const PAIRING_TTL_MILLISECONDS = 10 * 60 * 1000;
const PAIRING_RATE_WINDOW_MILLISECONDS = 30 * 60 * 1000;
const MAX_PAIRINGS_PER_WINDOW = 3;
const DEVICE_TTL_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const PAIRING_CODE_PATTERN = /^[A-Z2-9]{16}$/u;
const DEVICE_TOKEN_PATTERN = /^ovd_[A-Za-z0-9_-]{43}$/u;

export class ExtensionSocialDeviceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ExtensionSocialDeviceError';
  }
}

export class ExtensionSocialDeviceService {
  constructor(
    private readonly repository: ExtensionSocialDeviceRepository,
    private readonly clock: () => number = Date.now
  ) {}

  async start(input: { extensionId: string; deviceName: string }): Promise<ExtensionSocialPairingStart> {
    const extensionId = normalizeExtensionId(input.extensionId);
    const deviceName = normalizeDeviceName(input.deviceName);
    const now = this.clock();
    const recent = await this.repository.countRecentPairings(
      extensionId,
      now - PAIRING_RATE_WINDOW_MILLISECONDS
    );
    if (recent >= MAX_PAIRINGS_PER_WINDOW) {
      throw new ExtensionSocialDeviceError(
        'EXTENSION_PAIRING_RATE_LIMITED',
        '配对请求过于频繁，请稍后再试',
        429
      );
    }
    const pairingId = crypto.randomUUID();
    const pairingCode = randomPairingCode();
    const expiresTimeUtc = now + PAIRING_TTL_MILLISECONDS;
    await this.repository.createPairing({
      id: pairingId,
      pairingCodeHash: await sha256Hex(pairingCode),
      extensionId,
      deviceName,
      status: 'pending',
      approvedBy: null,
      deviceId: null,
      expiresTimeUtc,
      createTimeUtc: now,
      updateTimeUtc: now
    });
    return { pairingId, pairingCode, status: 'pending', expiresTimeUtc };
  }

  async status(input: {
    pairingId: string;
    pairingCode: string;
    extensionId: string;
  }): Promise<ExtensionSocialPairingStatus> {
    const pairingCode = normalizePairingCode(input.pairingCode);
    const extensionId = normalizeExtensionId(input.extensionId);
    const pairing = await this.repository.findPairing(input.pairingId, await sha256Hex(pairingCode));
    if (pairing?.extensionId !== extensionId) throw pairingNotFound();
    const now = this.clock();
    if (pairing.expiresTimeUtc <= now && pairing.status !== 'consumed') {
      await this.repository.expirePairing(pairing.id, now);
      return pairingStatus(pairing.id, 'expired', pairing.expiresTimeUtc);
    }
    if (pairing.status === 'pending' || pairing.status === 'cancelled' || pairing.status === 'expired') {
      return pairingStatus(pairing.id, pairing.status, pairing.expiresTimeUtc);
    }
    if (pairing.status === 'consumed') {
      const device = pairing.deviceId ? await this.repository.findDevice(pairing.deviceId) : null;
      return pairingStatus(
        pairing.id,
        'consumed',
        pairing.expiresTimeUtc,
        device ? publicDevice(device) : null
      );
    }

    const approvedBy = pairing.approvedBy;
    if (!approvedBy) throw new ExtensionSocialDeviceError('EXTENSION_PAIRING_INVALID', '配对状态无效', 409);
    const deviceToken = `ovd_${randomBase64Url(32)}`;
    const deviceId = crypto.randomUUID();
    const device: ExtensionSocialDeviceRecord = {
      id: deviceId,
      tokenHash: await sha256Hex(deviceToken),
      extensionId: pairing.extensionId,
      name: pairing.deviceName,
      status: 'active',
      expiresTimeUtc: now + DEVICE_TTL_MILLISECONDS,
      lastUsedTimeUtc: null,
      createTimeUtc: now,
      updateTimeUtc: now,
      creatorId: approvedBy,
      updaterId: approvedBy,
      revision: 1,
      remark: null
    };
    await this.repository.createDevice(device);
    if (!(await this.repository.consumePairing(pairing.id, deviceId, now))) {
      await this.repository.revokeOrphanDevice(deviceId, 'system:maintenance', now);
      return pairingStatus(pairing.id, 'consumed', pairing.expiresTimeUtc);
    }
    return {
      pairingId: pairing.id,
      status: 'paired',
      expiresTimeUtc: pairing.expiresTimeUtc,
      device: publicDevice(device),
      deviceToken
    };
  }

  async approve(pairingCode: string, actorId: string): Promise<ExtensionSocialPairingStatus> {
    const normalizedCode = normalizePairingCode(pairingCode);
    const pairing = await this.repository.findPairingByCodeHash(await sha256Hex(normalizedCode));
    if (!pairing) throw pairingNotFound();
    const now = this.clock();
    if (pairing.expiresTimeUtc <= now) {
      await this.repository.expirePairing(pairing.id, now);
      throw new ExtensionSocialDeviceError('EXTENSION_PAIRING_EXPIRED', '配对码已过期', 409);
    }
    if (pairing.status !== 'pending' || !(await this.repository.approvePairing(pairing.id, actorId, now))) {
      throw new ExtensionSocialDeviceError('EXTENSION_PAIRING_NOT_PENDING', '配对码已处理', 409);
    }
    return pairingStatus(pairing.id, 'approved', pairing.expiresTimeUtc);
  }

  list(): Promise<ExtensionSocialDevice[]> {
    return this.repository.listDevices(this.clock());
  }

  async revoke(input: { deviceId: string; revision: number; actorId: string }): Promise<void> {
    const revoked = await this.repository.revokeDevice(
      input.deviceId,
      input.revision,
      input.actorId,
      this.clock()
    );
    if (!revoked) {
      throw new ExtensionSocialDeviceError('ENTITY_VERSION_CONFLICT', '设备已被其他请求更新或已经撤销', 409);
    }
  }

  async authenticate(input: {
    deviceToken: string;
    extensionId: string;
  }): Promise<{ actorId: string; device: ExtensionSocialDevice }> {
    if (!DEVICE_TOKEN_PATTERN.test(input.deviceToken)) throw deviceUnauthorized();
    const extensionId = normalizeExtensionId(input.extensionId);
    const device = await this.repository.findDeviceByTokenHash(await sha256Hex(input.deviceToken));
    const now = this.clock();
    if (device?.extensionId !== extensionId || device.status !== 'active') {
      throw deviceUnauthorized();
    }
    if (device.expiresTimeUtc <= now) {
      await this.repository.revokeDevice(device.id, device.revision, 'system:maintenance', now);
      throw new ExtensionSocialDeviceError('EXTENSION_DEVICE_EXPIRED', '扩展设备授权已过期', 401);
    }
    await this.repository.touchDevice(device.id, now);
    return { actorId: `extension-device:${device.id}`, device: publicDevice(device) };
  }
}

function pairingStatus(
  pairingId: string,
  status: ExtensionSocialPairingStatus['status'],
  expiresTimeUtc: number,
  device: ExtensionSocialDevice | null = null
): ExtensionSocialPairingStatus {
  return { pairingId, status, expiresTimeUtc, device, deviceToken: null };
}

function normalizeExtensionId(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  if (!EXTENSION_ID_PATTERN.test(normalized)) {
    throw new ExtensionSocialDeviceError('EXTENSION_ID_INVALID', 'Chrome 扩展 ID 无效', 400);
  }
  return normalized;
}

function normalizeDeviceName(value: string): string {
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > 80) {
    throw new ExtensionSocialDeviceError('EXTENSION_DEVICE_NAME_INVALID', '设备名称需为 1–80 个字符', 400);
  }
  return normalized;
}

function normalizePairingCode(value: string): string {
  const normalized = value.trim().toLocaleUpperCase().replaceAll('-', '');
  if (!PAIRING_CODE_PATTERN.test(normalized)) throw pairingNotFound();
  return normalized;
}

function pairingNotFound(): ExtensionSocialDeviceError {
  return new ExtensionSocialDeviceError('EXTENSION_PAIRING_NOT_FOUND', '配对码不存在或已失效', 404);
}

function deviceUnauthorized(): ExtensionSocialDeviceError {
  return new ExtensionSocialDeviceError('EXTENSION_DEVICE_UNAUTHORIZED', '扩展设备授权无效', 401);
}

function randomPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join('');
}

function randomBase64Url(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
