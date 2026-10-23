import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { AuthError } from './auth-errors';

/**
 * Cross-cutting authorization rules for identity administration. Deny by default:
 *  - only system administrators (`users.isSystemAdmin`, i.e. system.superadmin) can
 *    act on other system administrators, grant global (company-less) roles, or grant
 *    roles containing permissions they do not hold themselves;
 *  - company-level admins act only inside their active, membership-validated company
 *    and never on themselves.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  /** Target must share the actor's active company (unless actor is a system admin). */
  async assertCanManageUser(actor: AuthUser, targetUserId: string): Promise<void> {
    const target = await this.prisma.user.findFirst({ where: { id: targetUserId, deletedAt: null }, select: { id: true, isSystemAdmin: true } });
    if (!target) throw new AuthError('FORBIDDEN');
    if (actor.isSystemAdmin) return;
    if (target.isSystemAdmin) throw new AuthError('FORBIDDEN', 'Only system administrators can manage system administrators');
    if (!actor.companyId) throw new AuthError('FORBIDDEN');
    const membership = await this.prisma.companyMembership.findUnique({ where: { userId_companyId: { userId: targetUserId, companyId: actor.companyId } } });
    if (!membership) throw new AuthError('FORBIDDEN');
  }

  /** Validates a role grant before it is written. */
  async assertCanGrantRole(actor: AuthUser, input: { roleId: string; companyId: string | null; targetUserId?: string }): Promise<{ code: string; name: string }> {
    const role = await this.prisma.role.findFirst({
      where: { id: input.roleId, deletedAt: null },
      select: { code: true, name: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    if (!role) throw new AuthError('FORBIDDEN', 'Unknown role');
    if (actor.isSystemAdmin) return role;
    if (input.targetUserId && input.targetUserId === actor.id) throw new AuthError('FORBIDDEN', 'You cannot change your own roles');
    if (!input.companyId || input.companyId !== actor.companyId) throw new AuthError('FORBIDDEN', 'Roles can only be granted in your active company');
    if (role.code === 'SYSTEM_ADMIN') throw new AuthError('FORBIDDEN', 'Only system administrators can grant this role');
    const held = await this.rbac.getPermissions(actor.id, actor.companyId);
    const missing = role.permissions.map((p) => p.permission.code).filter((code) => !held.has(code));
    if (missing.length) throw new AuthError('FORBIDDEN', 'A role can only contain permissions you hold yourself');
    if (input.targetUserId) await this.assertCanManageUser(actor, input.targetUserId);
    return role;
  }

  async assertCanBundlePermissions(actor: AuthUser, codes: string[]): Promise<void> {
    if (actor.isSystemAdmin) return;
    const held = await this.rbac.getPermissions(actor.id, actor.companyId);
    if (codes.some((code) => !held.has(code))) throw new AuthError('FORBIDDEN', 'A role can only contain permissions you hold yourself');
  }
}
