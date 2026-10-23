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
  'DirectMessage',
  'ExchangeRate',
  'PositionPlan',
  'OrgChartVersion',
  'StaffingBudgetScenario',
  'StaffingBudgetRevision',
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
  private readonly emailHook = this.registerEmailNormalization();
  /** Extended client applying soft-delete semantics. Use for business queries. */
  readonly client = this.buildExtendedClient();

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Keeps users.emailNormalized (unique, case-insensitive identity key) in sync for
   * every write path, including generic record management and seeds.
   */
  private registerEmailNormalization() {
    this.$use(async (params, next) => {
      if (params.model === 'User' && ['create', 'update', 'upsert', 'updateMany', 'createMany'].includes(params.action)) {
        const apply = (data: Record<string, unknown> | undefined) => {
          if (data && typeof data.email === 'string') {
            const email = data.email.trim();
            data.email = email;
            data.emailNormalized = email.normalize('NFKC').toLowerCase();
          }
        };
        const args = params.args as { data?: unknown; create?: Record<string, unknown>; update?: Record<string, unknown> };
        if (Array.isArray(args.data)) args.data.forEach((d) => apply(d as Record<string, unknown>));
        else apply(args.data as Record<string, unknown> | undefined);
        apply(args.create);
        apply(args.update);
      }
      return next(params);
    });
    return true;
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
