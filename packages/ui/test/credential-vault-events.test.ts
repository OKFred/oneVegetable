import { describe, expect, it } from 'vitest';
import { isMaterialVaultSessionChange } from '../src/lib/credential-vault-events';

const session = {
  schemaVersion: 1,
  recordSalt: 'salt',
  recordIv: 'iv',
  recordCiphertext: 'ciphertext',
  sessionKeyMaterial: 'synthetic-test-key',
  lastActivityAt: 1
};

describe('vault session refresh filtering', () => {
  it('ignores every read touch, preventing a settings load -> touch -> reload loop', () => {
    let oldValue = session;
    for (let time = 2; time < 20; time++) {
      const newValue = { ...oldValue, lastActivityAt: time };
      expect(isMaterialVaultSessionChange({ oldValue, newValue })).toBe(false);
      oldValue = newValue;
    }
  });
  it.each(['recordSalt', 'recordIv', 'recordCiphertext', 'sessionKeyMaterial'])(
    'notices %s changes',
    (key) => {
      expect(
        isMaterialVaultSessionChange({ oldValue: session, newValue: { ...session, [key]: 'changed' } })
      ).toBe(true);
    }
  );
  it('notices first unlock, removal, manual lock and unlock from a lock marker', () => {
    const marker = { schemaVersion: 2, state: 'locked' };
    expect(isMaterialVaultSessionChange({ newValue: session })).toBe(true);
    expect(isMaterialVaultSessionChange({ oldValue: session })).toBe(true);
    expect(isMaterialVaultSessionChange({ oldValue: session, newValue: marker })).toBe(true);
    expect(isMaterialVaultSessionChange({ oldValue: marker, newValue: session })).toBe(true);
    expect(isMaterialVaultSessionChange({ oldValue: marker, newValue: { ...marker } })).toBe(false);
  });
});
