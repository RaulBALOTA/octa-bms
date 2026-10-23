import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EngineConfig } from '../../../../../packages/shared/src/business-engine';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { DEFAULT_ENGINE_CONFIG, resolveConfig } from './domain/config';
import { engineCall } from './access';
import { SettingsDto } from './dto';

@Injectable()
export class EngineSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(companyId: string) {
    const row = await this.prisma.engineSettings.findUnique({ where: { companyId } });
    if (!row) return { version: 0, config: DEFAULT_ENGINE_CONFIG, confirmedAt: null, updatedAt: null, defaults: DEFAULT_ENGINE_CONFIG };
    return { version: row.version, config: engineCall(() => resolveConfig(row.config)), confirmedAt: row.confirmedAt, updatedAt: row.updatedAt, defaults: DEFAULT_ENGINE_CONFIG };
  }

  async config(companyId: string): Promise<EngineConfig> { return (await this.get(companyId)).config; }

  async update(companyId: string, userId: string, dto: SettingsDto) {
    const current = await this.prisma.engineSettings.findUnique({ where: { companyId } });
    if ((current?.version ?? 0) !== (dto.expectedVersion ?? current?.version ?? 0)) throw new ConflictException('Settings changed in the meantime. Reload and try again.');
    const confirmed = dto.confirm || !!current?.confirmedAt;
    const config = engineCall(() => resolveConfig({ ...dto.config, illustrative: !confirmed }));
    const json = config as unknown as Prisma.InputJsonValue;
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = current
        ? await tx.engineSettings.update({ where: { id: current.id }, data: { config: json, version: current.version + 1, updatedById: userId, ...(dto.confirm && !current.confirmedAt ? { confirmedAt: new Date() } : {}) } })
        : await tx.engineSettings.create({ data: { companyId, config: json, updatedById: userId, confirmedAt: dto.confirm ? new Date() : null } });
      await tx.engineSettingsRevision.create({ data: { settingsId: row.id, version: row.version, config: json, note: dto.note ?? null, createdById: userId } });
      return row;
    });
    await this.audit.log({ userId, companyId, entityType: 'engine_settings', entityId: saved.id, action: current ? 'UPDATE' : 'CREATE',
      changes: this.audit.diff((current?.config ?? null) as Record<string, unknown> | null, config as unknown as Record<string, unknown>) });
    return this.get(companyId);
  }

  revisions(companyId: string) {
    return this.prisma.engineSettingsRevision.findMany({ where: { settings: { companyId } }, orderBy: { version: 'desc' }, take: 50,
      select: { version: true, note: true, createdById: true, createdAt: true, config: true } });
  }
}
