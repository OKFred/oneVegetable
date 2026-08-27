import { describe, expect, it } from 'vitest';

import rootPackage from '../../../package.json' with { type: 'json' };
import { APP_VERSION } from '../src/version';

describe('application version', () => {
  it('uses the root package version as the runtime source of truth', () => {
    expect(APP_VERSION).toBe(rootPackage.version);
  });
});
