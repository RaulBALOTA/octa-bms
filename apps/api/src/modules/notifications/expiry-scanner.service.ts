import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const CONTRACT_WARN_DAYS = 90;
const CERTIFICATE_WARN_DAYS = 60;

/**
 * Daily scanners producing proactive notifications: expiring contracts,
 * expiring employee certificates, upcoming birthdays. Recipients: contract
 * owners / affected employees' users plus users holding manager roles for the
 * module (kept simple here; workflow-based routing replaces this later).
 */
@Injectable()
export class ExpiryScannerService {
  private readonly logger = new Logger(ExpiryScannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async scan() {
    await Promise.all([
      this.scanContracts(),
      this.scanCertificates(),
      this.scanBirthdays(),
      this.markOverdueInvoices(),
      this.gdprDeleteApplicants(),
    ]);
  }

  /**
   * GDPR retention: applicant records past their deletion date are removed
   * for good (hard delete — the one place soft delete does not apply).
   */
  private async gdprDeleteApplicants() {
    const due = await this.prisma.applicant.findMany({
      where: { gdprDeleteBy: { not: null, lt: new Date() } },
      select: { id: true },
    });
    if (!due.length) return;
    const ids = due.map((applicant) => applicant.id);
    await this.prisma.interview.deleteMany({ where: { applicantId: { in: ids } } });
    await this.prisma.$executeRaw`DELETE FROM applicants WHERE id = ANY(${ids})`;
    this.logger.log(`GDPR: hard-deleted ${ids.length} applicants past retention`);
  }

  /** SENT/PARTIALLY_PAID invoices past their due date become OVERDUE. */
  private async markOverdueInvoices() {
    const result = await this.prisma.invoice.updateMany({
      where: {
        deletedAt: null,
        status: { in: ['SENT', 'PARTIALLY_PAID'] },
        dueDate: { lt: new Date() },
      },
      data: { status: 'OVERDUE' },
    });
    if (result.count > 0) {
      this.logger.log(`marked ${result.count} invoices OVERDUE`);
    }
  }

  private async scanContracts() {
    const horizon = new Date(Date.now() + CONTRACT_WARN_DAYS * 86_400_000);
    const contracts = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        endDate: { not: null, lte: horizon, gte: new Date() },
      },
      include: { owner: { select: { userId: true } } },
    });
    for (const contract of contracts) {
      const userId = contract.owner?.userId;
      if (!userId) continue;
      const already = await this.prisma.notification.findFirst({
        where: {
          userId,
          type: 'CONTRACT_EXPIRING',
          entityId: contract.id,
          createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
      });
      if (already) continue;
      await this.notifications.notify({
        userIds: [userId],
        type: 'CONTRACT_EXPIRING',
        title: `Contract ${contract.contractNumber} expires ${contract.endDate?.toISOString().slice(0, 10)}`,
        entityType: 'contract',
        entityId: contract.id,
        link: `/contracts/${contract.id}`,
      });
    }
    this.logger.log(`contract expiry scan: ${contracts.length} candidates`);
  }

  private async scanCertificates() {
    const horizon = new Date(Date.now() + CERTIFICATE_WARN_DAYS * 86_400_000);
    const certs = await this.prisma.employeeCertificate.findMany({
      where: { expiryDate: { not: null, lte: horizon, gte: new Date() } },
      include: { employee: { select: { userId: true, firstName: true, lastName: true } } },
    });
    for (const cert of certs) {
      const userId = cert.employee.userId;
      if (!userId) continue;
      const already = await this.prisma.notification.findFirst({
        where: {
          userId,
          type: 'CERTIFICATE_EXPIRING',
          entityId: cert.id,
          createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
        },
      });
      if (already) continue;
      await this.notifications.notify({
        userIds: [userId],
        type: 'CERTIFICATE_EXPIRING',
        title: `Certificate "${cert.name}" expires ${cert.expiryDate?.toISOString().slice(0, 10)}`,
        entityType: 'employeeCertificate',
        entityId: cert.id,
      });
    }
  }

  private async scanBirthdays() {
    const today = new Date();
    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null, status: 'ACTIVE', birthDate: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        manager: { select: { userId: true } },
      },
    });
    const celebrating = employees.filter(
      (e) =>
        e.birthDate!.getDate() === today.getDate() &&
        e.birthDate!.getMonth() === today.getMonth(),
    );
    for (const employee of celebrating) {
      const managerUserId = employee.manager?.userId;
      if (!managerUserId) continue;
      await this.notifications.notify({
        userIds: [managerUserId],
        type: 'BIRTHDAY',
        title: `🎂 ${employee.firstName} ${employee.lastName} has a birthday today`,
        entityType: 'employee',
        entityId: employee.id,
      });
    }
  }
}
