// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fixtures from '../../../mock/data/alibaba-auth/standalone-json-imports.json';
import {
  authorizationJsonExample,
  highlightAuthorizationJson,
  parseAuthorizationJson
} from '../lib/authorization-json-editor';

describe('advanced authorization JSON editor', () => {
  it('selects only the current protocol from a validated dual array', () => {
    const text = JSON.stringify([fixtures.top, fixtures.iop]);
    expect(parseAuthorizationJson(text, 'top')).toEqual(fixtures.top);
    expect(parseAuthorizationJson(text, 'iop')).toEqual(fixtures.iop);
    expect(() => parseAuthorizationJson(JSON.stringify([fixtures.top, {}]), 'top')).toThrow(
      'AUTH_JSON_INVALID'
    );
    expect(() => parseAuthorizationJson(JSON.stringify([fixtures.iop, fixtures.iop]), 'iop')).toThrow(
      'AUTH_JSON_INVALID'
    );
  });
  it.each(['top', 'iop'] as const)(
    'accepts a complete %s bundle but never its example placeholders',
    (protocol) => {
      expect(parseAuthorizationJson(JSON.stringify(fixtures[protocol]), protocol).protocol).toBe(protocol);
      const example = authorizationJsonExample(protocol);
      expect(JSON.parse(example) as unknown).toHaveProperty('protocol', protocol);
      expect(() => parseAuthorizationJson(example, protocol)).toThrow('AUTH_JSON_EXAMPLE');
      expect(example).not.toContain(fixtures[protocol].application.appSecret);
    }
  );
  it('keeps old unmarked bundles TOP and rejects cross-protocol imports', () => {
    expect(() => parseAuthorizationJson(JSON.stringify(fixtures.top), 'iop')).toThrow('IOP_REQUIRED');
    expect(() => parseAuthorizationJson(JSON.stringify(fixtures.iop), 'top')).toThrow('TOP_REQUIRED');
    const old = { ...fixtures.top, protocol: undefined };
    expect(parseAuthorizationJson(JSON.stringify(old), 'top').application.appKey).toBe(
      fixtures.top.application.appKey
    );
  });
  it('returns only safe error codes, never the pasted text', () => {
    expect(() => parseAuthorizationJson(fixtures.iop.application.appSecret, 'iop')).toThrow(
      'AUTH_JSON_INVALID'
    );
    expect(() => parseAuthorizationJson(' '.repeat(65_537), 'iop')).toThrow('AUTH_JSON_TOO_LARGE');
    expect(() => parseAuthorizationJson(JSON.stringify(fixtures.invalidIop), 'iop')).toThrow(
      'AUTH_JSON_INVALID'
    );
  });
  it('preserves pasted source as text rather than executing markup while highlighting', () => {
    const target = document.createElement('code');
    const json = JSON.stringify({ field: '<script>alert(1)</script>', enabled: true, count: 1 });
    highlightAuthorizationJson(target, json);
    expect(target.textContent).toBe(json);
    expect(target.querySelector('script')).toBeNull();
    expect(target.querySelectorAll('.json-key')).toHaveLength(3);
  });
});
