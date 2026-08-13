import { describe, expect, it } from 'vitest';

import {
  authorizeAdmin,
  authorizeOperation,
  extensionAdminPrincipal,
  StaticOperationFeatureFlags
} from '../src/abac';

import type { AuthPrincipal } from '../src/auth/types';

const user: AuthPrincipal = {
  actorId: 'user-1',
  username: 'reader',
  role: 'user',
  source: 'bff'
};
const admin: AuthPrincipal = { ...user, actorId: 'admin-1', username: 'admin', role: 'admin' };

describe('ABAC', () => {
  it('allows users only active read operations and keeps admin endpoints exclusive', () => {
    expect(authorizeOperation(user, 'listProducts', {}, new StaticOperationFeatureFlags())).toMatchObject({
      allowed: true
    });
    expect(authorizeOperation(user, 'updateProduct', {}, new StaticOperationFeatureFlags())).toMatchObject({
      allowed: false,
      reasonCode: 'USER_MUTATION_DENIED'
    });
    expect(authorizeAdmin(user, 'admin.read')).toMatchObject({
      allowed: false,
      reasonCode: 'ADMIN_REQUIRED'
    });
    expect(authorizeAdmin(admin, 'admin.write')).toMatchObject({ allowed: true });
  });

  it('requires a server-side mutation flag even for administrators', () => {
    expect(authorizeOperation(admin, 'updateProduct', {}, new StaticOperationFeatureFlags())).toMatchObject({
      allowed: false,
      reasonCode: 'MUTATION_FLAG_DISABLED'
    });
    expect(
      authorizeOperation(
        admin,
        'updateProduct',
        {},
        new StaticOperationFeatureFlags(new Set(['operation:updateProduct']))
      )
    ).toMatchObject({ allowed: true });
  });

  it('treats extension mode as local admin without creating a BFF session', () => {
    expect(extensionAdminPrincipal()).toEqual({
      actorId: 'extension:local-admin',
      username: '本机管理员',
      role: 'admin',
      source: 'extension'
    });
  });
});
