interface RequestContextValue {
  actorId?: string;
  operation?: string;
}

const REQUEST_CONTEXT = new WeakMap<Request, RequestContextValue>();

export function markRequestActor(request: Request, actorId: string): void {
  const current = REQUEST_CONTEXT.get(request) ?? {};
  REQUEST_CONTEXT.set(request, { ...current, actorId });
}

export function markRequestOperation(request: Request, operation: string): void {
  const current = REQUEST_CONTEXT.get(request) ?? {};
  REQUEST_CONTEXT.set(request, { ...current, operation });
}

export function readRequestContext(request: Request): RequestContextValue {
  return REQUEST_CONTEXT.get(request) ?? {};
}
