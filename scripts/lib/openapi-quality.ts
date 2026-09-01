const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);
const PROBE_PATHS = new Set(['/healthz', '/readyz']);
const PROTOCOL_GET_PATHS = new Set(['/social/meta/oauth/callback', '/social-media/{opaqueToken}']);

export interface OpenApiQualityIssue {
  pointer: string;
  message: string;
}

export function inspectOpenApiQuality(document: unknown): OpenApiQualityIssue[] {
  const issues: OpenApiQualityIssue[] = [];
  const root = asRecord(document);
  const paths = asRecord(root?.paths);

  if (!root || !paths) {
    return [{ pointer: '#/paths', message: 'OpenAPI document must define a paths object.' }];
  }

  for (const [path, pathValue] of Object.entries(paths)) {
    const pathPointer = `#/paths/${escapePointer(path)}`;
    const pathItem = asRecord(pathValue);
    if (!pathItem) {
      issues.push({ pointer: pathPointer, message: 'Path item must be an object.' });
      continue;
    }

    if ('parameters' in pathItem) {
      issues.push({
        pointer: `${pathPointer}/parameters`,
        message: 'Path and query parameters are forbidden; use a JSON request body.'
      });
    }

    const operations = Object.entries(pathItem).filter(([key]) => HTTP_METHODS.has(key));
    if (operations.length === 0) {
      issues.push({ pointer: pathPointer, message: 'Path item must define an HTTP operation.' });
      continue;
    }

    for (const [method, operationValue] of operations) {
      inspectOperation(path, method, operationValue, `${pathPointer}/${method}`, issues);
    }
  }

  const componentParameters = asRecord(asRecord(root.components)?.parameters);
  if (componentParameters && Object.keys(componentParameters).length > 0) {
    issues.push({
      pointer: '#/components/parameters',
      message: 'Reusable path and query parameters are forbidden; use JSON body schemas.'
    });
  }

  return issues;
}

function inspectOperation(
  path: string,
  method: string,
  operationValue: unknown,
  pointer: string,
  issues: OpenApiQualityIssue[]
): void {
  const operation = asRecord(operationValue);
  if (!operation) {
    issues.push({ pointer, message: 'Operation must be an object.' });
    return;
  }

  if (PROBE_PATHS.has(path)) {
    if (method !== 'get') {
      issues.push({ pointer, message: 'Infrastructure probes must use GET.' });
    }
    if ('requestBody' in operation || 'parameters' in operation) {
      issues.push({ pointer, message: 'Infrastructure probes must not accept request parameters.' });
    }
    return;
  }

  if (PROTOCOL_GET_PATHS.has(path)) {
    if (method !== 'get') {
      issues.push({ pointer, message: 'Protocol callback and media routes must use GET.' });
    }
    if ('requestBody' in operation) {
      issues.push({ pointer, message: 'Protocol GET routes must not accept a request body.' });
    }
    if (path === '/social/meta/oauth/callback' && 'parameters' in operation) {
      issues.push({ pointer, message: 'OAuth callback parameters are defined by the external protocol.' });
    }
    return;
  }

  if (method !== 'post') {
    issues.push({ pointer, message: 'All non-probe operations must use POST.' });
  }
  if ('parameters' in operation) {
    issues.push({
      pointer: `${pointer}/parameters`,
      message: 'Operation parameters are forbidden; use a JSON request body.'
    });
  }

  const requestBody = asRecord(operation.requestBody);
  const content = asRecord(requestBody?.content);
  if (!requestBody || !content || !('application/json' in content)) {
    issues.push({
      pointer: `${pointer}/requestBody`,
      message: 'Non-probe operations must accept an application/json request body.'
    });
  }

  const responses = asRecord(operation.responses);
  const hasClientError = responses
    ? Object.keys(responses).some((status) => /^4(?:\d{2}|XX)$/.test(status))
    : false;
  if (!hasClientError) {
    issues.push({
      pointer: `${pointer}/responses`,
      message: 'Non-probe operations must document at least one 4xx response.'
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
