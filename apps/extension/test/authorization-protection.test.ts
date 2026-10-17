import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/alibaba-auth/authorization-protection.json';

import {
  ALIBABA_GATEWAY,
  SETTINGS_STORAGE_KEY,
  createCredentialVault,
  inspectCredentialStorage,
  restoreCredentialVaultSession,
  unlockCredentialVault,
  type CredentialVaultRecord,
  type GatewaySettings
} from '@one-vegetable/core';
import {
  openAlibabaAuthorization,
  resealAlibabaAuthorization,
  restoreAlibabaAuthorization,
  sealAlibabaAuthorization
} from '@one-vegetable/core/alibaba-authorization-vault';
import {
  parseAlibabaOpenApiCredentialBundle,
  type AlibabaOpenApiCredentialBundle
} from '@one-vegetable/core/credential-bundle';
import { AuthorizationProtection, DEVICE_PROTECTION_KEY } from '../lib/authorization-protection';
import {
  CREDENTIAL_VAULT_SESSION_STORAGE_KEY,
  ExtensionCredentialVaultSession,
  type ExtensionCredentialVaultSessionStorage
} from '../lib/credential-vault-session';

const passphrase = 'protection-fixture-passphrase';
const emptySettings: GatewaySettings = {
  appKey: '',
  appSecret: '',
  accessToken: '',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac'
};
const settings = fixture.settings as GatewaySettings;

class MemoryStorage implements ExtensionCredentialVaultSessionStorage {
  readonly values: Record<string, unknown>;
  readonly writes: Record<string, unknown>[] = [];
  failNextWriteContaining: string | undefined;

  constructor(initial: Record<string, unknown> = {}) {
    this.values = structuredClone(initial);
  }

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(key in this.values ? { [key]: structuredClone(this.values[key]) } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    if (this.failNextWriteContaining && this.failNextWriteContaining in items) {
      this.failNextWriteContaining = undefined;
      return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
    }
    this.writes.push(structuredClone(items));
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    Reflect.deleteProperty(this.values, key);
    return Promise.resolve();
  }
}

function setup(initial: Record<string, unknown> = {}) {
  const storage = new MemoryStorage(initial);
  const session = new ExtensionCredentialVaultSession(storage, () => 1_000);
  return { storage, session, protection: new AuthorizationProtection(storage, session) };
}

function recordIn(storage: MemoryStorage): CredentialVaultRecord {
  const state = inspectCredentialStorage(storage.values[SETTINGS_STORAGE_KEY]);
  if (state.kind !== 'vault') throw new Error('Expected an encrypted workbench');
  return state.record;
}

function expectNoPlaintext(storage: MemoryStorage, extra: (string | null | undefined)[] = []) {
  const serialized = JSON.stringify({ values: storage.values, writes: storage.writes });
  const credentials = [settings, ...Object.values(settings.protocolCredentials ?? {})];
  for (const secret of [
    passphrase,
    ...credentials.flatMap((credential) => [
      credential.appKey,
      credential.appSecret,
      credential.accessToken,
      credential.refreshToken
    ]),
    ...extra
  ]) {
    if (typeof secret === 'string' && secret.length > 0) expect(serialized).not.toContain(secret);
  }
}

function bundleFor(protocol: 'top' | 'iop'): AlibabaOpenApiCredentialBundle {
  return parseAlibabaOpenApiCredentialBundle({ ...fixture.oauthBundle, protocol });
}

describe('authorization protection creation', () => {
  it('prepares an empty workbench with random device protection and ciphertext only', async () => {
    const { storage, session, protection } = setup();
    const prepared = await protection.prepare('');
    const record = recordIn(storage);

    expect(storage.values[DEVICE_PROTECTION_KEY]).toEqual({
      schemaVersion: 1,
      salt: record.kdf.salt,
      sessionKeyMaterial: prepared.sessionKeyMaterial
    });
    expect(await protection.deviceKey(record)).toBe(prepared.sessionKeyMaterial);
    expect(atob(prepared.sessionKeyMaterial)).toHaveLength(32);
    expect(prepared.salt).toBe(record.kdf.salt);
    expect(prepared.key.extractable).toBe(false);
    expect((await session.read(record))?.value.settings).toEqual(emptySettings);
    expect((await restoreCredentialVaultSession(record, prepared.sessionKeyMaterial)).settings).toEqual(
      emptySettings
    );
    const another = await setup().protection.prepare('');
    expect(another.sessionKeyMaterial).not.toBe(prepared.sessionKeyMaterial);
    expect(another.salt).not.toBe(prepared.salt);
    expectNoPlaintext(storage);
  });

  it.each(['', passphrase])('encrypts both credential slots when create receives %j', async (input) => {
    const { storage, session, protection } = setup();
    const created = await protection.create(settings, input);
    const record = recordIn(storage);
    expect(record).toEqual(created.record);
    expect((await session.read(record))?.value.settings).toEqual(settings);
    expect((await restoreCredentialVaultSession(record, created.sessionKeyMaterial)).settings).toEqual(
      settings
    );
    if (input) {
      expect(storage.values[DEVICE_PROTECTION_KEY]).toBeNull();
      expect(await protection.deviceKey(record)).toBeUndefined();
      expect((await unlockCredentialVault(record, input)).settings).toEqual(settings);
    } else {
      expect(await protection.deviceKey(record)).toBe(created.sessionKeyMaterial);
    }
    expectNoPlaintext(storage);
  });

  it.each(['a', '12345', '     '])(
    'rejects a nonempty short passphrase %j without changes',
    async (input) => {
      const { storage, protection } = setup({ unrelated: { preserved: true } });
      const before = structuredClone(storage.values);
      await expect(protection.prepare(input)).rejects.toMatchObject({ code: 'PASSPHRASE_TOO_SHORT' });
      expect(storage.values).toEqual(before);
      expect(storage.writes).toEqual([]);
    }
  );

  it('accepts a six-character passphrase and does not persist it', async () => {
    const { storage, protection } = setup();
    await protection.prepare('123456');
    expect((await unlockCredentialVault(recordIn(storage), '123456')).settings).toEqual(emptySettings);
    expect(storage.values[DEVICE_PROTECTION_KEY]).toBeNull();
    expectNoPlaintext(storage, ['123456']);
  });
});

// Preparation reuses existing protection rather than rotating it.

describe('authorization protection preparation', () => {
  it('reuses an unlocked key for TOP and IOP without changing its original passphrase', async () => {
    const { storage, protection } = setup();
    const created = await protection.create(settings, passphrase);
    const before = structuredClone(storage.values);
    const writeCount = storage.writes.length;
    const top = await protection.prepare('x');
    const iop = await protection.prepare('replacement-passphrase');

    expect(top.key).toBe(created.key);
    expect(iop.key).toBe(top.key);
    expect(iop.sessionKeyMaterial).toBe(created.sessionKeyMaterial);
    expect(iop.salt).toBe(created.record.kdf.salt);
    expect(storage.values).toEqual(before);
    expect(storage.writes).toHaveLength(writeCount);
    for (const [protocol, prepared] of [
      ['top', top],
      ['iop', iop]
    ] as const) {
      const bundle = bundleFor(protocol);
      const record = await resealAlibabaAuthorization(bundle, prepared.key, prepared.salt, protocol);
      expect((await openAlibabaAuthorization(record, passphrase, protocol)).bundle).toEqual(bundle);
      expect((await restoreAlibabaAuthorization(record, top.sessionKeyMaterial, protocol)).bundle).toEqual(
        bundle
      );
      await expect(
        restoreAlibabaAuthorization(record, top.sessionKeyMaterial, protocol === 'top' ? 'iop' : 'top')
      ).rejects.toThrow('AUTH_UNLOCK_FAILED');
    }
    await expect(unlockCredentialVault(created.record, 'replacement-passphrase')).rejects.toMatchObject({
      code: 'VAULT_UNLOCK_FAILED'
    });
    expectNoPlaintext(storage, ['replacement-passphrase']);
  });

  it.each([
    ['unversioned', settings],
    ['version one', { version: 1, settings }]
  ])('encrypts %s legacy settings without losing either protocol or its binding', async (_label, legacy) => {
    const { storage, session, protection } = setup({ [SETTINGS_STORAGE_KEY]: legacy });
    await protection.prepare('');
    const record = recordIn(storage);
    expect((await session.read(record))?.value.settings).toEqual(settings);
    expectNoPlaintext(storage);
  });

  it('opens an older locked workbench only with its original passphrase without rewriting it', async () => {
    const older = await createCredentialVault(settings, passphrase, { idleTimeoutMinutes: 5 });
    const { storage, session, protection } = setup({ [SETTINGS_STORAGE_KEY]: older.record });
    const before = structuredClone(storage.values);

    await expect(protection.prepare('')).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
    await expect(protection.prepare('incorrect-passphrase')).rejects.toMatchObject({
      code: 'VAULT_UNLOCK_FAILED'
    });
    expect(storage.values).toEqual(before);
    expect(await session.read(older.record)).toBeUndefined();

    const prepared = await protection.prepare(passphrase);
    expect(prepared.sessionKeyMaterial).toBe(older.sessionKeyMaterial);
    expect(recordIn(storage)).toEqual(older.record);
    expect(storage.values).not.toHaveProperty(DEVICE_PROTECTION_KEY);
    expect((await session.read(older.record))?.value.settings).toEqual(settings);
    expect((await unlockCredentialVault(recordIn(storage), passphrase)).policy).toEqual({
      idleTimeoutMinutes: 5
    });
    expectNoPlaintext(storage, ['incorrect-passphrase']);
  });

  it('keeps a device-protected manual lock across reads and worker restarts until explicit prepare', async () => {
    const { storage, session, protection } = setup();
    const original = await protection.create(settings, '');
    await session.lock();
    const before = structuredClone(storage.values);
    const restartedSession = new ExtensionCredentialVaultSession(storage, () => 2_000);
    const restarted = new AuthorizationProtection(storage, restartedSession);

    expect(await protection.deviceKey(original.record)).toBe(original.sessionKeyMaterial);
    expect(await session.read(original.record)).toBeUndefined();
    expect(await restartedSession.read(original.record)).toBeUndefined();
    await expect(restartedSession.protection(original.record)).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
    await expect(restarted.prepare('incorrect-passphrase')).rejects.toMatchObject({
      code: 'VAULT_UNLOCK_FAILED'
    });
    expect(storage.values).toEqual(before);
    expect(restartedSession.lockReason).toBe('manual');

    const prepared = await restarted.prepare('');
    expect(prepared.sessionKeyMaterial).toBe(original.sessionKeyMaterial);
    expect(recordIn(storage)).toEqual(original.record);
    expect((await restartedSession.read(original.record))?.value.settings).toEqual(settings);
    expect(restartedSession.lockReason).toBeNull();
    expectNoPlaintext(storage, ['incorrect-passphrase']);
  });

  it.each([null, {}, { version: 2, cipher: { ciphertext: 'broken' } }])(
    'rejects invalid existing workbench data %j without replacing it',
    async (value) => {
      const { storage, protection } = setup({ [SETTINGS_STORAGE_KEY]: value });
      const before = structuredClone(storage.values);
      await expect(protection.prepare('')).rejects.toThrow('CREDENTIAL_VAULT_INVALID');
      expect(storage.values).toEqual(before);
      expect(storage.writes).toEqual([]);
    }
  );

  it('does not replace a damaged ciphertext when the original passphrase cannot authenticate it', async () => {
    const created = await createCredentialVault(settings, passphrase);
    const damaged = structuredClone(created.record);
    const ciphertext = damaged.cipher.ciphertext;
    damaged.cipher.ciphertext = (ciphertext.startsWith('A') ? 'B' : 'A') + ciphertext.slice(1);
    const { storage, session, protection } = setup({ [SETTINGS_STORAGE_KEY]: damaged });
    const before = structuredClone(storage.values);

    await expect(protection.prepare(passphrase)).rejects.toMatchObject({ code: 'VAULT_UNLOCK_FAILED' });
    expect(storage.values).toEqual(before);
    expect(storage.writes).toEqual([]);
    expect(await session.read(damaged)).toBeUndefined();
  });
});

// Tool adoption must never replace an independently protected workbench.

describe('authorization protection adoption', () => {
  it.each(['top', 'iop'] as const)(
    'adopts an existing %s key while retaining the tool passphrase and ciphertext',
    async (protocol) => {
      const bundle = bundleFor(protocol);
      const tool = await sealAlibabaAuthorization(bundle, passphrase, protocol);
      const { storage, session, protection } = setup({ toolVault: tool.record });
      await protection.adopt(tool);
      const record = recordIn(storage);
      expect(record.kdf.salt).toBe(tool.record.salt);
      expect(storage.values.toolVault).toEqual(tool.record);
      expect(storage.values[DEVICE_PROTECTION_KEY]).toBeNull();
      expect(await protection.deviceKey(record)).toBeUndefined();
      expect((await session.protection(record)).sessionKeyMaterial).toBe(tool.sessionKeyMaterial);
      expect((await unlockCredentialVault(record, passphrase)).settings).toEqual(emptySettings);
      expect((await openAlibabaAuthorization(tool.record, passphrase, protocol)).bundle).toEqual(bundle);

      await session.lock();
      await expect(protection.prepare('')).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
      await expect(protection.prepare('incorrect-passphrase')).rejects.toMatchObject({
        code: 'VAULT_UNLOCK_FAILED'
      });
      expect((await protection.prepare(passphrase)).sessionKeyMaterial).toBe(tool.sessionKeyMaterial);
      expect(recordIn(storage)).toEqual(record);
      expectNoPlaintext(storage, [
        bundle.application.appKey,
        bundle.application.appSecret,
        bundle.oauth.accessToken,
        bundle.oauth.refreshToken,
        'incorrect-passphrase'
      ]);
    }
  );

  it.each(['vault', 'legacy', 'invalid'] as const)(
    'leaves an existing %s workbench and manual-lock marker untouched',
    async (kind) => {
      const original = await createCredentialVault(settings, passphrase);
      const tool = await sealAlibabaAuthorization(bundleFor('iop'), 'different-tool-passphrase');
      const value = kind === 'vault' ? original.record : kind === 'legacy' ? settings : { damaged: true };
      const { storage, session, protection } = setup({
        [SETTINGS_STORAGE_KEY]: value,
        [DEVICE_PROTECTION_KEY]: { existing: 'preserved' }
      });
      await session.lock();
      const before = structuredClone(storage.values);
      const writeCount = storage.writes.length;
      await protection.adopt(tool);
      expect(storage.values).toEqual(before);
      expect(storage.writes).toHaveLength(writeCount);
      expect(await session.read(original.record)).toBeUndefined();
      expect(session.lockReason).toBe('manual');
    }
  );

  it('rejects mismatched adopted key material before writing anything', async () => {
    const tool = await sealAlibabaAuthorization(bundleFor('top'), passphrase, 'top');
    const { storage, protection } = setup({ unrelated: 'preserved' });
    const before = structuredClone(storage.values);
    await expect(protection.adopt({ ...tool, sessionKeyMaterial: btoa('0'.repeat(32)) })).rejects.toThrow();
    expect(storage.values).toEqual(before);
    expect(storage.writes).toEqual([]);
  });
});

describe('authorization protection device recovery validation', () => {
  it.each([
    'missing',
    'null',
    'array',
    'old schema',
    'wrong salt',
    'missing key',
    'invalid base64',
    'short key'
  ])('does not unlock using a %s recovery record', async (kind) => {
    const { storage, session, protection } = setup();
    const created = await protection.create(settings, '');
    await session.lock();
    const valid = {
      schemaVersion: 1,
      salt: created.record.kdf.salt,
      sessionKeyMaterial: created.sessionKeyMaterial
    };
    const candidates: Record<string, unknown> = {
      missing: undefined,
      null: null,
      array: [],
      'old schema': { ...valid, schemaVersion: 2 },
      'wrong salt': { ...valid, salt: btoa('s'.repeat(16)) },
      'missing key': { schemaVersion: 1, salt: valid.salt },
      'invalid base64': { ...valid, sessionKeyMaterial: '!'.repeat(43) + '=' },
      'short key': { ...valid, sessionKeyMaterial: btoa('short') }
    };
    if (kind === 'missing') await storage.remove(DEVICE_PROTECTION_KEY);
    else storage.values[DEVICE_PROTECTION_KEY] = candidates[kind];
    const before = structuredClone(storage.values);

    expect(await protection.deviceKey(created.record)).toBeUndefined();
    await expect(protection.prepare('')).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
    expect(storage.values).toEqual(before);
    expect(await session.read(created.record)).toBeUndefined();
    expect(session.lockReason).toBe('manual');
  });

  it('authenticates even a correctly shaped but damaged device key and keeps the vault locked', async () => {
    const { storage, session, protection } = setup();
    const created = await protection.create(settings, '');
    await session.lock();
    storage.values[DEVICE_PROTECTION_KEY] = {
      schemaVersion: 1,
      salt: created.record.kdf.salt,
      sessionKeyMaterial: btoa('0'.repeat(32))
    };
    const before = structuredClone(storage.values);
    await expect(protection.prepare('')).rejects.toMatchObject({ code: 'VAULT_UNLOCK_FAILED' });
    expect(storage.values).toEqual(before);
    expect(await session.read(created.record)).toBeUndefined();
    expect(session.lockReason).toBe('manual');
    expectNoPlaintext(storage);
  });
});

// Every failed prepare must leave the previous durable workbench intact.

describe('authorization protection prepare failure atomicity', () => {
  it.each([
    ['empty', SETTINGS_STORAGE_KEY],
    ['legacy', SETTINGS_STORAGE_KEY],
    ['empty', CREDENTIAL_VAULT_SESSION_STORAGE_KEY],
    ['legacy', CREDENTIAL_VAULT_SESSION_STORAGE_KEY]
  ] as const)(
    'preserves the %s workbench when quota rejects the write containing %s',
    async (kind, failingKey) => {
      const { storage, session, protection } = setup({
        unrelated: { preserved: true },
        ...(kind === 'legacy' ? { [SETTINGS_STORAGE_KEY]: settings } : {})
      });
      const before = structuredClone(storage.values);
      storage.failNextWriteContaining = failingKey;
      await expect(protection.prepare('')).rejects.toThrow('QUOTA_BYTES');

      expect(inspectCredentialStorage(storage.values[SETTINGS_STORAGE_KEY]).kind).toBe(kind);
      expect(storage.values).toEqual(before);
      expect(storage.values).not.toHaveProperty(DEVICE_PROTECTION_KEY);
      expect(storage.values).not.toHaveProperty(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);

      // A rejected preparation must not poison the next explicit attempt.
      const retried = await protection.prepare('');
      const record = recordIn(storage);
      expect((await session.read(record))?.value.settings).toEqual(
        kind === 'legacy' ? settings : emptySettings
      );
      expect(await protection.deviceKey(record)).toBe(retried.sessionKeyMaterial);
    }
  );

  it('keeps an existing manual lock when remembering a successful password fails quota', async () => {
    const created = await createCredentialVault(settings, passphrase);
    const { storage, session, protection } = setup({ [SETTINGS_STORAGE_KEY]: created.record });
    await session.lock();
    const before = structuredClone(storage.values);
    storage.failNextWriteContaining = CREDENTIAL_VAULT_SESSION_STORAGE_KEY;

    await expect(protection.prepare(passphrase)).rejects.toThrow('QUOTA_BYTES');
    expect(storage.values).toEqual(before);
    expect(await session.read(created.record)).toBeUndefined();
    expect(session.lockReason).toBe('manual');
    expect((await protection.prepare(passphrase)).sessionKeyMaterial).toBe(created.sessionKeyMaterial);
    expectNoPlaintext(storage);
  });
});
