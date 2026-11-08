import { isRequestId } from '@one-vegetable/core';
import { parseShippingServicesRequest, ShippingServicesError } from '@one-vegetable/core/shipping-services';
import { bodyLimit } from 'hono/body-limit';
import type { Context, Hono } from 'hono';

import { authorizeAdmin } from '../abac';
import { authenticateMutation } from '../auth/routes';
import { AuthError, type AuthService } from '../auth/service';
import { markRequestOperation } from '../observability/request-context';
import type { ShippingServicesService } from './service';

export function registerShippingServicesRoutes(
  api: Hono,
  options: {
    authService: AuthService;
    service: () => Promise<ShippingServicesService>;
    allowedOrigins?: readonly string[];
  }
): void {
  for (const action of ['configuration', 'save', 'clear', 'quote'] as const) {
    api.post(
      `/admin/shipping-services/${action}`,
      bodyLimit({
        maxSize: 16 * 1024,
        onError: (context) => failure(context, crypto.randomUUID(), 413, 'SHIPPING_REQUEST_TOO_LARGE')
      }),
      async (context) => {
        let requestId: string = crypto.randomUUID();
        try {
          if (!context.req.header('Content-Type')?.toLowerCase().startsWith('application/json'))
            throw new AuthError('SHIPPING_REQUEST_INVALID', 'SHIPPING_REQUEST_INVALID', 400);
          let raw: unknown;
          try {
            raw = await context.req.json();
          } catch {
            throw new AuthError('SHIPPING_REQUEST_INVALID', 'SHIPPING_REQUEST_INVALID', 400);
          }
          if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new AuthError('SHIPPING_REQUEST_INVALID', 'SHIPPING_REQUEST_INVALID', 400);
          if ('requestId' in raw && isRequestId(raw.requestId)) requestId = raw.requestId;
          if ('action' in raw)
            throw new AuthError('SHIPPING_REQUEST_INVALID', 'SHIPPING_REQUEST_INVALID', 400);
          const session = await authenticateMutation(context, options);
          const decision = authorizeAdmin(
            session.principal,
            action === 'configuration' ? 'admin.read' : 'admin.write'
          );
          if (!decision.allowed) throw new AuthError(decision.reasonCode, decision.reasonCode, 403);
          const request = parseShippingServicesRequest({ ...raw, action });
          requestId = request.requestId;
          markRequestOperation(context.req.raw, `shipping-services.${action}`);
          const data = await (await options.service()).execute(session.principal.actorId, request);
          context.header('Cache-Control', 'no-store');
          context.header('X-Request-ID', requestId);
          return context.json({ requestId, ok: true, data });
        } catch (error) {
          const code =
            error instanceof AuthError || error instanceof ShippingServicesError
              ? error.code
              : 'SHIPPING_SERVICES_FAILED';
          const status =
            error instanceof AuthError
              ? error.status
              : code === 'SHIPPING_LOCAL_DAILY_LIMIT' || code === 'SHIPPING_PROVIDER_RATE_LIMIT'
                ? 429
                : [
                      'SHIPPING_CONFIGURATION_CHANGED',
                      'SHIPPING_QUOTE_ALREADY_SENT',
                      'SHIPPING_QUOTE_IN_PROGRESS'
                    ].includes(code)
                  ? 409
                  : [
                        'SHIPPING_SERVICES_UNAVAILABLE',
                        'SHIPPING_CREDENTIAL_ENCRYPTION_KEY_INVALID',
                        'SHIPPING_CONFIGURATION_UNREADABLE'
                      ].includes(code)
                    ? 503
                    : code === 'SHIPPING_SERVICES_FAILED'
                      ? 500
                      : 400;
          return failure(context, requestId, status, code);
        }
      }
    );
  }
}

function failure(context: Context, requestId: string, status: number, code: string): Response {
  context.header('Cache-Control', 'no-store');
  context.header('X-Request-ID', requestId);
  return context.json(
    { requestId, ok: false, error: { code, message: code, retryable: false } },
    status as 400
  );
}
