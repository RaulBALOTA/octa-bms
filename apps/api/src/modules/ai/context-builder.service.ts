import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface EntityContext {
  title: string;
  /** Read permission required to use this entity as AI context. */
  permission: string;
  text: string;
}

const fmt = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : '—';

/**
 * Turns a business entity into a compact, grounded text context for AI
 * features. Every query is company-scoped; the caller's read permission for
 * the entity type is returned and enforced by the controller.
 */
@Injectable()
export class ContextBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    companyId: string,
    entityType: string,
    entityId: string,
  ): Promise<EntityContext> {
    switch (entityType) {
      case 'partner':
        return this.partner(companyId, entityId);
      case 'contract':
        return this.contract(companyId, entityId);
      case 'opportunity':
        return this.opportunity(companyId, entityId);
      case 'invoice':
        return this.invoice(companyId, entityId);
      case 'meeting':
        return this.meeting(companyId, entityId);
      default:
        throw new NotFoundException(`Unsupported entity type: ${entityType}`);
    }
  }

  private async partner(companyId: string, id: string): Promise<EntityContext> {
    const partner = await this.prisma.businessPartner.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        contacts: { where: { deletedAt: null } },
        crmActivities: {
          where: { deletedAt: null },
          orderBy: { activityDate: 'desc' },
          take: 15,
          include: { owner: { select: { firstName: true, lastName: true } } },
        },
        opportunities: { where: { deletedAt: null } },
        contracts: { where: { deletedAt: null } },
        invoices: { where: { deletedAt: null } },
      },
    });
    if (!partner) throw new NotFoundException('Partner not found');

    const lines = [
      `BUSINESS PARTNER: ${partner.name} (${partner.partnerNumber}, ${partner.type}, status ${partner.status})`,
      `City: ${partner.city ?? '—'} · Segment: ${partner.segment ?? '—'} · VAT ID: ${partner.vatId ?? '—'}`,
      partner.notes ? `Notes: ${partner.notes}` : '',
      '',
      `CONTACTS (${partner.contacts.length}):`,
      ...partner.contacts.map(
        (c) => `- ${c.firstName} ${c.lastName}${c.position ? `, ${c.position}` : ''}${c.email ? ` <${c.email}>` : ''}`,
      ),
      '',
      `RECENT ACTIVITIES (${partner.crmActivities.length}):`,
      ...partner.crmActivities.map(
        (a) =>
          `- ${fmt(a.activityDate)} [${a.type}] ${a.subject}${a.owner ? ` (${a.owner.firstName} ${a.owner.lastName})` : ''}${a.description ? ` — ${a.description}` : ''}`,
      ),
      '',
      `OPPORTUNITIES (${partner.opportunities.length}): ${partner.opportunities.map((o) => `${o.title} [${o.stage}, ${o.estimatedValue ?? '?'} EUR]`).join('; ') || '—'}`,
      `CONTRACTS (${partner.contracts.length}): ${partner.contracts.map((c) => `${c.contractNumber} ${c.title} [${c.status}, ${c.value ?? '?'} EUR]`).join('; ') || '—'}`,
      `INVOICES (${partner.invoices.length}): ${partner.invoices.map((i) => `${i.invoiceNumber} [${i.status}, ${i.grossAmount} EUR]`).join('; ') || '—'}`,
    ];
    return {
      title: partner.name,
      permission: 'crm.partners.read',
      text: lines.filter(Boolean).join('\n'),
    };
  }

  private async contract(companyId: string, id: string): Promise<EntityContext> {
    const contract = await this.prisma.contract.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        partner: true,
        contractType: true,
        obligations: true,
        milestones: true,
        variations: true,
        claims: true,
        guarantees: true,
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    const lines = [
      `CONTRACT: ${contract.contractNumber} — ${contract.title} [${contract.status}]`,
      `Partner: ${contract.partner?.name ?? '—'} · Type: ${contract.contractType.name}`,
      `Value: ${contract.value ?? '—'} ${contract.currencyCode} · Term: ${fmt(contract.startDate)} → ${fmt(contract.endDate)} · Signed: ${fmt(contract.signedDate)}`,
      `Notice period: ${contract.noticePeriodDays ?? '—'} days · Auto-renewal: ${contract.autoRenewal}`,
      '',
      `PAYMENT MILESTONES: ${contract.milestones.map((m) => `${m.title} ${m.amount} EUR (due ${fmt(m.dueDate)}, ${m.isInvoiced ? 'invoiced' : 'open'})`).join('; ') || '—'}`,
      `OBLIGATIONS: ${contract.obligations.map((o) => `${o.title} (due ${fmt(o.dueDate)}, ${o.isFulfilled ? 'fulfilled' : 'open'})`).join('; ') || '—'}`,
      `VARIATION ORDERS: ${contract.variations.map((v) => `${v.voNumber} ${v.title} ${v.amount} EUR [${v.status}]`).join('; ') || '—'}`,
      `CLAIMS: ${contract.claims.map((c) => `${c.claimNumber} ${c.title} ${c.amount ?? '?'} EUR [${c.status}]`).join('; ') || '—'}`,
      `BANK GUARANTEES: ${contract.guarantees.map((g) => `${g.guaranteeNumber} ${g.type} ${g.amount} EUR [${g.status}, expires ${fmt(g.expiryDate)}]`).join('; ') || '—'}`,
    ];
    return {
      title: `${contract.contractNumber} ${contract.title}`,
      permission: 'contracts.contracts.read',
      text: lines.join('\n'),
    };
  }

  private async opportunity(
    companyId: string,
    id: string,
  ): Promise<EntityContext> {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        partner: true,
        goNoGo: true,
        proposals: { include: { feeLines: true } },
        crmActivities: {
          where: { deletedAt: null },
          orderBy: { activityDate: 'desc' },
          take: 10,
        },
      },
    });
    if (!opportunity) throw new NotFoundException('Opportunity not found');

    const gng = opportunity.goNoGo;
    const lines = [
      `OPPORTUNITY: ${opportunity.opportunityNumber} — ${opportunity.title} [${opportunity.stage}, ${opportunity.probability}%]`,
      `Client: ${opportunity.partner.name} · Value: ${opportunity.estimatedValue ?? '—'} EUR · Deadline: ${fmt(opportunity.submissionDeadline)}`,
      opportunity.lostReason ? `Lost reason: ${opportunity.lostReason}` : '',
      gng
        ? `GO/NO-GO: ${gng.decision ?? 'pending'} (score ${gng.totalScore}/25 — relation ${gng.clientRelation}, fit ${gng.strategicFit}, capacity ${gng.capacity}, win ${gng.winProbability}, risk ${gng.riskLevel})${gng.comments ? ` — ${gng.comments}` : ''}`
        : 'GO/NO-GO: not evaluated',
      '',
      `PROPOSALS: ${opportunity.proposals.map((p) => `${p.proposalNumber} ${p.title} [${p.status}] fee ${p.totalFee ?? '?'} EUR, margin ${p.marginPercent ?? '?'}%`).join('; ') || '—'}`,
      `RECENT ACTIVITIES: ${opportunity.crmActivities.map((a) => `${fmt(a.activityDate)} [${a.type}] ${a.subject}`).join('; ') || '—'}`,
    ];
    return {
      title: opportunity.title,
      permission: 'sales.opportunities.read',
      text: lines.filter(Boolean).join('\n'),
    };
  }

  private async invoice(companyId: string, id: string): Promise<EntityContext> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        partner: true,
        lines: { include: { taxCode: true } },
        payments: { include: { payment: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const lines = [
      `INVOICE: ${invoice.invoiceNumber} (${invoice.direction}) [${invoice.status}]`,
      `Partner: ${invoice.partner.name} · Date: ${fmt(invoice.invoiceDate)} · Due: ${fmt(invoice.dueDate)} · Dunning level: ${invoice.dunningLevel}`,
      `Net ${invoice.netAmount} / VAT ${invoice.taxAmount} / Gross ${invoice.grossAmount} ${invoice.currencyCode} · Paid: ${invoice.paidAmount}`,
      '',
      `LINE ITEMS:`,
      ...invoice.lines.map(
        (l) => `- ${l.description}: ${l.quantity} ${l.unit} × ${l.unitPrice} = ${l.netAmount} EUR (${l.taxCode.code})`,
      ),
      `PAYMENTS: ${invoice.payments.map((p) => `${fmt(p.payment.paymentDate)} ${p.amount} EUR`).join('; ') || '—'}`,
    ];
    return {
      title: invoice.invoiceNumber,
      permission: 'finance.invoices.read',
      text: lines.join('\n'),
    };
  }

  private async meeting(companyId: string, id: string): Promise<EntityContext> {
    const meeting = await this.prisma.meetingMinute.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const actionItems = await this.prisma.task.findMany({
      where: { entityType: 'meeting', entityId: id, deletedAt: null },
      include: { assignee: { select: { firstName: true, lastName: true } } },
    });
    const lines = [
      `MEETING MINUTES: ${meeting.title} [${meeting.status}]`,
      `Date: ${fmt(meeting.meetingDate)} · Location: ${meeting.location ?? '—'}`,
      `Participants: ${meeting.participants.join(', ') || '—'}`,
      '',
      'NOTES:',
      meeting.content,
      '',
      `ACTION ITEMS: ${actionItems.map((task) => `${task.title} → ${task.assignee.firstName} ${task.assignee.lastName} [${task.status}${task.dueDate ? `, due ${fmt(task.dueDate)}` : ''}]`).join('; ') || '—'}`,
    ];
    return {
      title: meeting.title,
      permission: 'communication.meetings.read',
      text: lines.join('\n'),
    };
  }

  /**
   * Company-wide snapshot for "ask the BMS" — sections included only when the
   * caller holds the matching read permission.
   */
  async companySnapshot(
    companyId: string,
    can: (permission: string) => boolean,
  ): Promise<string> {
    const sections: string[] = [
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
    ];

    if (can('crm.partners.read')) {
      const clients = await this.prisma.businessPartner.count({
        where: { companyId, deletedAt: null, type: 'CLIENT', status: 'ACTIVE' },
      });
      sections.push(`ACTIVE CLIENTS: ${clients}`);
    }

    if (can('sales.opportunities.read')) {
      const open = await this.prisma.opportunity.findMany({
        where: {
          companyId,
          deletedAt: null,
          stage: { in: ['LEAD', 'QUALIFIED', 'GO_NO_GO', 'PROPOSAL', 'NEGOTIATION'] },
        },
        include: { partner: { select: { name: true } } },
      });
      sections.push(
        `PIPELINE (${open.length} open): ${open.map((o) => `${o.title} @${o.partner.name} [${o.stage}, ${o.estimatedValue ?? '?'} EUR, ${o.probability}%]`).join('; ') || '—'}`,
      );
    }

    if (can('contracts.contracts.read')) {
      const active = await this.prisma.contract.findMany({
        where: { companyId, deletedAt: null, status: 'ACTIVE' },
        include: { partner: { select: { name: true } } },
      });
      const expiring = active.filter(
        (c) => c.endDate && c.endDate < new Date(Date.now() + 180 * 86_400_000),
      );
      sections.push(
        `ACTIVE CONTRACTS (${active.length}): ${active.map((c) => `${c.contractNumber} ${c.title} @${c.partner?.name ?? '—'} [${c.value ?? '?'} EUR, until ${fmt(c.endDate)}]`).join('; ') || '—'}`,
        `EXPIRING WITHIN 180 DAYS: ${expiring.map((c) => c.contractNumber).join(', ') || 'none'}`,
      );
    }

    if (can('finance.invoices.read')) {
      const open = await this.prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        include: { partner: { select: { name: true } } },
      });
      const totalOpen = open.reduce(
        (sum, i) => sum + Number(i.grossAmount) - Number(i.paidAmount),
        0,
      );
      sections.push(
        `OPEN ITEMS (${open.length}, total ${totalOpen.toFixed(2)} EUR): ${open.map((i) => `${i.invoiceNumber} @${i.partner.name} ${(Number(i.grossAmount) - Number(i.paidAmount)).toFixed(2)} EUR [${i.status}, due ${fmt(i.dueDate)}, Mahnstufe ${i.dunningLevel}]`).join('; ') || '—'}`,
      );
    }

    if (can('hr.employees.read')) {
      const headcount = await this.prisma.employee.count({
        where: { companyId, deletedAt: null, status: 'ACTIVE' },
      });
      sections.push(`ACTIVE EMPLOYEES: ${headcount}`);
    }

    if (can('hr.leave.read')) {
      const pending = await this.prisma.leaveRequest.count({
        where: { status: 'REQUESTED', employee: { companyId } },
      });
      sections.push(`PENDING LEAVE REQUESTS: ${pending}`);
    }

    return sections.join('\n');
  }
}
