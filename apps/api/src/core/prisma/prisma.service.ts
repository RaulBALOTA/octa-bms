import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma client with global soft-delete behavior.
 *
 * Models carrying a `deletedAt` column are filtered on every read and
 * `delete`/`deleteMany` are converted to soft deletes. Hard deletion is only
 * possible through `$executeRaw` inside dedicated GDPR retention jobs.
 */
const SOFT_DELETE_EXEMPT = new Set([
  'AuditLog',
  'ActivityLog',
  'Notification',
  'OutboxEvent',
  'RefreshToken',
  'Permission',
  'RolePermission',
  'UserRole',
  'UserGroup',
  'CompanyMembership',
  'EntityTag',
  'Favorite',
  'NumberSequence',
  'ExchangeRate',
  'Country',
  'Currency',
  'LanguageRef',
]);

function hasSoftDelete(model: string | undefined): boolean {
  return !!model && !SOFT_DELETE_EXEMPT.has(model);
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /** Extended client applying soft-delete semantics. Use for business queries. */
  readonly client = this.buildExtendedClient();

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private buildExtendedClient() {
    const base = this;
    return this.$extends({
      query: {
        $allModels: {
          async findMany({ model, args, query }) {
            if (hasSoftDelete(model)) {
              args.where = { deletedAt: null, ...args.where };
            }
            return query(args);
          },
          async findFirst({ model, args, query }) {
            if (hasSoftDelete(model)) {
              args.where = { deletedAt: null, ...args.where };
            }
            return query(args);
          },
          async count({ model, args, query }) {
            if (hasSoftDelete(model)) {
              args.where = { deletedAt: null, ...args.where };
            }
            return query(args);
          },
          async delete({ model, args, query }) {
            if (hasSoftDelete(model)) {
              const delegate = (base as Record<string, any>)[lowerFirst(model)];
              return delegate.update({
                where: (args as { where: unknown }).where,
                data: { deletedAt: new Date() },
              });
            }
            return query(args);
          },
          async deleteMany({ model, args, query }) {
            if (hasSoftDelete(model)) {
              const delegate = (base as Record<string, any>)[lowerFirst(model)];
              return delegate.updateMany({
                where: (args as { where?: unknown }).where ?? {},
                data: { deletedAt: new Date() },
              });
            }
            return query(args);
          },
        },
      },
    });
  }
}
