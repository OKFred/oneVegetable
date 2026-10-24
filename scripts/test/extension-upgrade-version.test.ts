import { describe, expect, it } from 'vitest';

import { supportsUpgradeCredentialRecovery } from '../lib/extension-upgrade-version';

describe('upgrade credential recovery expectations', () => {
  it.each(['1.99.99', '2.5.0', '2.13.0', '2.15.1', '2.16.0'])(
    '%s requires the original passphrase once',
    (version) => {
      expect(supportsUpgradeCredentialRecovery(version)).toBe(false);
    }
  );

  it.each(['2.16.1', '2.16.2', '2.17.0', '2.17.1', '2.20.0', '3.0.0'])(
    '%s retains recovery without an automatic unlock prompt',
    (version) => {
      expect(supportsUpgradeCredentialRecovery(version)).toBe(true);
    }
  );

  it.each(['', 'v2.17.0', '2.17', '2.17.0-rc.1', '02.17.0'])(
    'rejects invalid stable version %j',
    (version) => {
      expect(() => supportsUpgradeCredentialRecovery(version)).toThrow('UPGRADE_INVALID_VERSION');
    }
  );
});
