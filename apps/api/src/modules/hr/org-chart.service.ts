import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PositionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

const positionSelect = {
  id: true, code: true, name: true, level: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.PositionSelect;
const versionSelect = {
  id: true, version: true, title: true, note: true, createdAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.OrgChartVersionSelect;

@Injectable()
export class OrgChartService {
  constructor(private readonly prisma: PrismaService) {}

  private positionScope(companyId: string): Prisma.PositionWhereInput {
    return { AND: [
      { OR: [{ departmentId: null }, { department: { companyId, deletedAt: null } }] },
      { OR: [{ isActive: true }, { employees: { some: { companyId, deletedAt: null, status: 'ACTIVE' } } }] },
    ] };
  }

  async positions(companyId: string, tx: Prisma.TransactionClient = this.prisma) {
    const positions = await tx.position.findMany({
      where: this.positionScope(companyId),
      select: { ...positionSelect,
        plans: { where: { companyId }, select: { status: true } },
        _count: { select: { employees: { where: { companyId, deletedAt: null, status: 'ACTIVE' } } } },
      }, orderBy: { name: 'asc' },
    });
    return positions.map(({ plans, _count, ...position }) => ({
      ...position,
      status: _count.employees > 0 ? PositionStatus.FILLED : plans[0]?.status ?? PositionStatus.OPEN,
    }));
  }

  async snapshot(companyId: string, tx: Prisma.TransactionClient) {
    const [departments, employees, positions] = await Promise.all([
      tx.department.findMany({ where: { companyId, deletedAt: null, isActive: true },
        select: { id: true, code: true, name: true, parentId: true, managerId: true }, orderBy: { name: 'asc' } }),
      tx.employee.findMany({ where: { companyId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, managerId: true,
          position: { select: positionSelect }, department: { select: { id: true, name: true } } },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      this.positions(companyId, tx),
    ]);
    return { schemaVersion: 1, departments, employees, positions };
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt >= 3 || !(error instanceof Prisma.PrismaClientKnownRequestError)
          || !['P2034', 'P2002'].includes(error.code)) throw error;
      }
    }
  }

  private async addVersion(tx: Prisma.TransactionClient, companyId: string, userId: string, title: string, note?: string) {
    const snapshot = await this.snapshot(companyId, tx);
    const latest = await tx.orgChartVersion.aggregate({ where: { companyId }, _max: { version: true } });
    return tx.orgChartVersion.create({ data: {
      companyId, createdById: userId, version: (latest._max.version ?? 0) + 1,
      title, note: note?.trim() || null, snapshot,
    }, select: versionSelect });
  }

  saveVersion(companyId: string, userId: string, title: string, note?: string) {
    return this.transaction((tx) => this.addVersion(tx, companyId, userId, title.trim(), note));
  }

  listVersions(companyId: string) {
    return this.prisma.orgChartVersion.findMany({ where: { companyId }, orderBy: { version: 'desc' }, select: versionSelect });
  }

  async getVersion(companyId: string, id: string) {
    const version = await this.prisma.orgChartVersion.findFirst({ where: { companyId, id },
      select: { ...versionSelect, snapshot: true } });
    if (!version) throw new NotFoundException('Org chart version not found in this company');
    return version;
  }

  setStatus(companyId: string, userId: string, positionId: string, status: PositionStatus) {
    return this.transaction(async (tx) => {
      const position = await tx.position.findFirst({ where: { id: positionId, ...this.positionScope(companyId) }, select: { id: true, name: true } });
      if (!position) throw new NotFoundException('Position not found in this company');
      const occupied = await tx.employee.count({ where: { companyId, positionId, deletedAt: null, status: 'ACTIVE' } });
      if (status === PositionStatus.FILLED && occupied === 0) throw new BadRequestException('Assign an active employee to fill this position');
      if (status !== PositionStatus.FILLED && occupied > 0) throw new ConflictException('This position is filled by an active employee');
      const plan = await tx.positionPlan.findUnique({ where: { companyId_positionId: { companyId, positionId } } });
      const current = occupied > 0 ? PositionStatus.FILLED : plan?.status ?? PositionStatus.OPEN;
      if (current === status) return { id: positionId, status: current };
      if (!await tx.orgChartVersion.count({ where: { companyId } })) await this.addVersion(tx, companyId, userId, 'Initial chart');
      else await this.addVersion(tx, companyId, userId, `Before ${position.name}: ${status}`);
      await tx.positionPlan.upsert({ where: { companyId_positionId: { companyId, positionId } },
        create: { companyId, positionId, status }, update: { status } });
      await this.addVersion(tx, companyId, userId, `${position.name}: ${status}`);
      return { id: positionId, status };
    });
  }
}
