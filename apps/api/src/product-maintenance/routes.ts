import { AlibabaClient, GatewayException, isRequestId } from '@one-vegetable/core';
import {
  ProductMaintenanceService,
  type ProductMaintenanceRepository
} from '@one-vegetable/core/product-maintenance-service';
import { createProductMaintenancePlatform } from '@one-vegetable/core/product-maintenance-platform';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '@one-vegetable/core/capability-validation-worker';
import { createProductOperationContext } from '@one-vegetable/core/product-operation-context';
import { isAccountVerifiedIopMethod } from '@one-vegetable/core/alibaba-iop-business';
import { productMaintenanceRuntimeWriteEnabled } from '@one-vegetable/core/product-maintenance-runtime-policy';
import type { KnownProductDraft } from '@one-vegetable/core/product-maintenance-api';
import { bodyLimit } from 'hono/body-limit';
import type { Hono } from 'hono';
import { authenticateMutation } from '../auth/routes';
import { AuthError, type AuthService } from '../auth/service';
import { authorizeAdmin, type OperationFeatureFlags } from '../abac';
import { GatewayConfigurationError, type AsyncAlibabaCredentialProvider } from '../gateway/credentials';
import { markRequestOperation } from '../observability/request-context';

export interface ProductMaintenanceRouteOptions {
  repository: ProductMaintenanceRepository;
  credentials: AsyncAlibabaCredentialProvider;
  auth: AuthService;
  flags: OperationFeatureFlags;
  runtime?: 'node' | 'cloudflare';
  allowedOrigins?: readonly string[];
  knownDrafts?: (ownerId: string, gateway: string) => Promise<readonly KnownProductDraft[]>;
}
export function registerProductMaintenanceRoutes(api: Hono, options: ProductMaintenanceRouteOptions): void {
  api.post('/product-maintenance/call', bodyLimit({ maxSize: 64 * 1024 }), async (context) => {
    let requestId: string = crypto.randomUUID();
    try {
      if (!context.req.header('Content-Type')?.toLowerCase().startsWith('application/json'))
        throw new AuthError('INVALID_CONTENT_TYPE', 'INVALID_CONTENT_TYPE', 400);
      const raw: unknown = await context.req.json();
      if (!raw || typeof raw !== 'object' || !('requestId' in raw) || !isRequestId(raw.requestId))
        throw new AuthError('INVALID_REQUEST_ID', 'INVALID_REQUEST_ID', 400);
      requestId = raw.requestId;
      const { validateProductValueMaintenanceRequest } =
        await import('../../../../packages/core/src/generated/validators-product-maintenance');
      if (!validateProductValueMaintenanceRequest(raw))
        throw new AuthError('REQUEST_CONTRACT_INVALID', 'REQUEST_CONTRACT_INVALID', 400);
      const session = await authenticateMutation(context, {
        authService: options.auth,
        ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
      });
      const decision = authorizeAdmin(session.principal, 'admin.write');
      if (!decision.allowed) throw new AuthError(decision.reasonCode, decision.reasonCode, 403);
      const ownerId = session.principal.actorId;
      markRequestOperation(context.req.raw, 'product-maintenance.call');
      const service = new ProductMaintenanceService(options.repository, async (expected, id, intent) => {
        const credentials = options.credentials.resolveForOperation
          ? await options.credentials.resolveForOperation(
              'callCapability',
              { method: intent.method, parameters: intent.parameters },
              { requestId: id, productContext: expected }
            )
          : await options.credentials.requireCredentials(id);
        if (credentials.protocol !== 'iop')
          throw new AuthError(
            'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
            'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
            403
          );
        const actual = await createProductOperationContext(ownerId, credentials);
        return createProductMaintenancePlatform({
          context: actual,
          validateRequest: validateCapabilityRequest,
          validateResponse: validateCapabilityResponse,
          client: AlibabaClient.create(credentials, { maxAttempts: 1, requestId: id }),
          enabled: productMaintenanceRuntimeWriteEnabled({
            method: intent.method,
            runtime: options.runtime === 'cloudflare' ? 'worker' : 'node',
            methodEnabled:
              isAccountVerifiedIopMethod(intent.method) && options.flags.isEnabled('method:' + intent.method),
            mutationsPaused:
              options.flags.disabledReason?.('method:' + intent.method) === 'REAL_MUTATIONS_PAUSED'
          }),
          ...(options.knownDrafts ? { knownDrafts: await options.knownDrafts(ownerId, actual.gateway) } : {})
        });
      });
      const data = await service.execute(ownerId, raw);
      const request = raw as unknown as { command: { action: string } };
      if (['create', 'send', 'cancel'].includes(request.command.action))
        await options.auth.audit({
          requestId,
          actorId: ownerId,
          action: 'product-maintenance.' + request.command.action,
          resourceKind: 'product-maintenance-task',
          resourceId: data.tasks[0]?.id ?? null,
          outcome: 'success',
          reasonCode: data.tasks[0]?.status ?? 'COMPLETED'
        });
      context.header('Cache-Control', 'no-store');
      context.header('X-Request-ID', requestId);
      return context.json({ requestId, ok: true, data });
    } catch (error) {
      const code =
        error instanceof AuthError || error instanceof GatewayConfigurationError
          ? error.code
          : error instanceof GatewayException
            ? error.gatewayError.code
            : error instanceof Error && /^[A-Z_]{1,128}$/u.test(error.message)
              ? error.message
              : 'PRODUCT_MAINTENANCE_FAILED';
      context.header('Cache-Control', 'no-store');
      context.header('X-Request-ID', requestId);
      return context.json(
        { requestId, ok: false, error: { code, message: code, retryable: false } },
        error instanceof AuthError ? (error.status as 400) : 400
      );
    }
  });
}
