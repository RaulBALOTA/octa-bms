import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuthUser } from '../auth/decorators';
import { AuditService } from './audit.service';

const METHOD_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

/**
 * Writes an audit_logs row for every mutating request. The entity type is
 * derived from the route (`/api/v1/crm/partners/:id` → "crm/partners"), the
 * entity id from the route param or the response body. Command handlers that
 * need field-level diffs call AuditService.log with a diff explicitly.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const action = METHOD_ACTION[req.method];
    if (!action || req.path.startsWith('/api/v1/auth')) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((body: unknown) => {
        const entityType = req.path
          .replace(/^\/api\/v1\//, '')
          .split('/')
          .slice(0, 2)
          .join('/');
        const entityId =
          (req.params as Record<string, string | undefined>).id ??
          (body as { id?: string } | null)?.id ??
          'n/a';
        // fire-and-forget; audit failure must not fail the request,
        // but it is logged by the process logger
        void this.audit
          .log({
            userId: req.user?.id,
            companyId: req.user?.companyId,
            entityType,
            entityId,
            action,
            ipAddress: req.ip,
            userAgent: req.header('user-agent'),
          })
          .catch((err) => console.error('audit log failed', err));
      }),
    );
  }
}
