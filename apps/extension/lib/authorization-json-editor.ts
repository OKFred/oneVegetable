import {
  parseAlibabaCredentialImport,
  type AlibabaOpenApiCredentialBundle
} from '@one-vegetable/core/credential-bundle';

export function authorizationJsonExample(protocol: 'top' | 'iop'): string {
  const time = '2026-01-01T00:00:00.000Z';
  // Documentation placeholders, not a simulated credential or valid authorization.
  return JSON.stringify(
    {
      schemaVersion: 1,
      protocol,
      capturedAtUtc: time,
      application: {
        appName: `YOUR_${protocol.toUpperCase()}_APP_NAME`,
        appKey: 'YOUR_APP_KEY',
        appSecret: 'YOUR_APP_SECRET',
        callbackUrl: 'https://your-domain.example/callback',
        status: 'Online',
        permissions: []
      },
      oauth: {
        accessToken: 'YOUR_ACCESS_TOKEN',
        refreshToken: null,
        expiresAtUtc: null,
        refreshExpiresAtUtc: null
      },
      callback: {
        receivedAtUtc: time,
        stateMatched: true,
        callbackOrigin: 'https://your-domain.example',
        callbackPath: '/callback'
      }
    },
    null,
    2
  );
}

export function parseAuthorizationJson(
  text: string,
  protocol: 'top' | 'iop'
): AlibabaOpenApiCredentialBundle {
  if (new TextEncoder().encode(text).length > 65_536) throw new Error('AUTH_JSON_TOO_LARGE');
  let bundle: AlibabaOpenApiCredentialBundle;
  try {
    const bundles = parseAlibabaCredentialImport(JSON.parse(text) as unknown);
    const selected = bundles.find((entry) => (entry.protocol ?? 'top') === protocol) ?? bundles[0];
    if (!selected) throw new Error('AUTH_JSON_INVALID');
    bundle = selected;
  } catch {
    throw new Error('AUTH_JSON_INVALID');
  }
  if ((bundle.protocol ?? 'top') !== protocol)
    throw new Error(protocol === 'top' ? 'TOP_REQUIRED' : 'IOP_REQUIRED');
  if (
    [
      bundle.application.appName,
      bundle.application.appKey,
      bundle.application.appSecret,
      bundle.oauth.accessToken
    ].some((value) => value.startsWith('YOUR_'))
  )
    throw new Error('AUTH_JSON_EXAMPLE');
  return bundle;
}

/** Lexical highlighting only. Text nodes prevent HTML/script execution in pasted JSON. */
export function highlightAuthorizationJson(target: HTMLElement, text: string): void {
  const fragment = document.createDocumentFragment();
  let end = 0;
  for (const match of text
    .slice(0, 65_536)
    .matchAll(/"(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/gu)) {
    fragment.append(document.createTextNode(text.slice(end, match.index)));
    const span = document.createElement('span');
    span.className = match[0].endsWith(':')
      ? 'json-key'
      : match[0].startsWith('"')
        ? 'json-string'
        : 'json-literal';
    span.textContent = match[0];
    fragment.append(span);
    end = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(end, 65_536)));
  target.replaceChildren(fragment);
}
