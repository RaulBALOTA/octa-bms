import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface SearchDoc {
  id: string; // `${type}-${entityId}` (Meili ids: alphanumeric, - and _)
  type: string;
  entityId: string;
  companyId: string;
  title: string;
  subtitle: string | null;
  link: string;
  text: string | null; // extra searchable content
}

const INDEX = 'records';

/**
 * Meilisearch integration (docs/06) via its plain REST API (the official JS
 * client is ESM-only and does not resolve from this CommonJS build).
 * Optional: enabled when MEILI_HOST is configured and reachable — the search
 * controller falls back to database search otherwise. Incremental updates via
 * domain events; full reindex via POST /search/reindex.
 */
@Injectable()
export class SearchIndexService {
  private readonly logger = new Logger(SearchIndexService.name);
  private ready = false;

  constructor(private readonly prisma: PrismaService) {}

  get configured(): boolean {
    return Boolean(process.env.MEILI_HOST);
  }

  private async meili<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${process.env.MEILI_HOST}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.MEILI_MASTER_KEY
          ? { Authorization: `Bearer ${process.env.MEILI_MASTER_KEY}` }
          : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      throw new Error(`meilisearch ${path} → ${response.status}`);
    }
    return (await response.json()) as T;
  }

  /** Reachability + one-time index settings. Never throws. */
  async isAvailable(): Promise<boolean> {
    if (!this.configured) return false;
    try {
      await this.meili('/health');
      if (!this.ready) {
        await this.meili(`/indexes/${INDEX}/settings`, {
          method: 'PATCH',
          body: {
            filterableAttributes: ['companyId', 'type'],
            searchableAttributes: ['title', 'subtitle', 'text'],
            displayedAttributes: ['id', 'type', 'entityId', 'title', 'subtitle', 'link'],
          },
        });
        this.ready = true;
      }
      return true;
    } catch {
      return false;
    }
  }

  async search(
    companyId: string,
    query: string,
    allowedTypes: string[],
    limit = 5,
  ): Promise<SearchDoc[] | null> {
    if (!(await this.isAvailable())) return null;
    if (!allowedTypes.length) return [];
    try {
      const result = await this.meili<{ hits: SearchDoc[] }>(
        `/indexes/${INDEX}/search`,
        {
          method: 'POST',
          body: {
            q: query,
            filter: [
              `companyId = "${companyId}"`,
              `type IN [${allowedTypes.join(', ')}]`,
            ],
            limit: limit * allowedTypes.length,
          },
        },
      );
      return result.hits;
    } catch (error) {
      this.logger.warn(`meilisearch query failed: ${String(error)}`);
      return null;
    }
  }

  private async upsert(docs: SearchDoc[]) {
    if (!docs.length || !(await this.isAvailable())) return;
    try {
      await this.meili(`/indexes/${INDEX}/documents?primaryKey=id`, {
        method: 'POST',
        body: docs,
      });
    } catch (error) {
      this.logger.warn(`meilisearch upsert failed: ${String(error)}`);
    }
  }

  /** Rebuilds the whole index from the database. Returns per-type counts. */
  async reindexAll(): Promise<Record<string, number>> {
    if (!(await this.isAvailable())) {
      return { error: -1 };
    }
    const [partners, contacts, employees, contracts, invoices, assets, opportunities, articles] =
      await Promise.all([
        this.prisma.businessPartner.findMany({ where: { deletedAt: null } }),
        this.prisma.contact.findMany({
          where: { deletedAt: null },
          include: { partner: { select: { companyId: true, name: true } } },
        }),
        this.prisma.employee.findMany({ where: { deletedAt: null } }),
        this.prisma.contract.findMany({
          where: { deletedAt: null },
          include: { partner: { select: { name: true } } },
        }),
        this.prisma.invoice.findMany({
          where: { deletedAt: null },
          include: { partner: { select: { name: true } } },
        }),
        this.prisma.asset.findMany({ where: { deletedAt: null } }),
        this.prisma.opportunity.findMany({
          where: { deletedAt: null },
          include: { partner: { select: { name: true } } },
        }),
        this.prisma.knowledgeArticle.findMany({ where: { deletedAt: null } }),
      ]);

    const docs: SearchDoc[] = [
      ...partners.map((p) => ({
        id: `partner-${p.id}`,
        type: 'partner',
        entityId: p.id,
        companyId: p.companyId,
        title: p.name,
        subtitle: `${p.partnerNumber} · ${p.city ?? ''}`,
        link: `/crm/partners/${p.id}`,
        text: [p.legalName, p.vatId, p.notes].filter(Boolean).join(' '),
      })),
      ...contacts.map((c) => ({
        id: `contact-${c.id}`,
        type: 'contact',
        entityId: c.id,
        companyId: c.partner.companyId,
        title: `${c.firstName} ${c.lastName}`,
        subtitle: c.partner.name,
        link: `/crm/partners`,
        text: [c.email, c.position, c.phone].filter(Boolean).join(' '),
      })),
      ...employees.map((e) => ({
        id: `employee-${e.id}`,
        type: 'employee',
        entityId: e.id,
        companyId: e.companyId,
        title: `${e.firstName} ${e.lastName}`,
        subtitle: e.discipline,
        link: `/hr/employees/${e.id}`,
        text: [e.employeeNumber, e.workEmail].filter(Boolean).join(' '),
      })),
      ...contracts.map((c) => ({
        id: `contract-${c.id}`,
        type: 'contract',
        entityId: c.id,
        companyId: c.companyId,
        title: c.title,
        subtitle: `${c.contractNumber} · ${c.partner?.name ?? ''}`,
        link: `/contracts`,
        text: c.description,
      })),
      ...invoices.map((i) => ({
        id: `invoice-${i.id}`,
        type: 'invoice',
        entityId: i.id,
        companyId: i.companyId,
        title: i.invoiceNumber,
        subtitle: `${i.partner.name} · ${i.grossAmount} ${i.currencyCode}`,
        link: `/finance/invoices/${i.id}`,
        text: [i.externalNumber, i.reference].filter(Boolean).join(' '),
      })),
      ...assets.map((a) => ({
        id: `asset-${a.id}`,
        type: 'asset',
        entityId: a.id,
        companyId: a.companyId,
        title: a.name,
        subtitle: a.assetNumber,
        link: `/assets/${a.id}`,
        text: [a.serialNumber, a.manufacturer, a.model].filter(Boolean).join(' '),
      })),
      ...opportunities.map((o) => ({
        id: `opportunity-${o.id}`,
        type: 'opportunity',
        entityId: o.id,
        companyId: o.companyId,
        title: o.title,
        subtitle: `${o.opportunityNumber} · ${o.partner.name}`,
        link: `/sales/pipeline`,
        text: o.description,
      })),
      ...articles.map((a) => ({
        id: `article-${a.id}`,
        type: 'article',
        entityId: a.id,
        // knowledge base is company-independent; index under a wildcard bucket
        companyId: 'shared',
        title: a.title,
        subtitle: a.type,
        link: `/knowledge`,
        text: a.content.slice(0, 3000),
      })),
    ];

    await this.meili(`/indexes/${INDEX}/documents`, { method: 'DELETE' });
    await this.upsert(docs);

    const counts: Record<string, number> = {};
    for (const doc of docs) counts[doc.type] = (counts[doc.type] ?? 0) + 1;
    this.logger.log(`reindexed ${docs.length} documents`);
    return counts;
  }

  // ------------------------------------------------------ incremental hooks

  /** Synchronize administrator edits and removals after their transaction commits. */
  async syncRecord(model: string, id: string): Promise<void> {
    const types: Record<string, string> = { BusinessPartner: 'partner', Contact: 'contact', Employee: 'employee', Contract: 'contract', Invoice: 'invoice', Asset: 'asset', Opportunity: 'opportunity', KnowledgeArticle: 'article' };
    const type = types[model];
    if (!type || !this.configured) return;
    try {
      const delegates = this.prisma as unknown as Record<string, { findUnique(args: object): Promise<{ deletedAt: Date | null } | null> }>;
      const row = await delegates[model[0].toLowerCase() + model.slice(1)].findUnique({ where: { id }, select: { deletedAt: true } });
      if (!row || row.deletedAt) {
        if (await this.isAvailable()) await this.meili(`/indexes/${INDEX}/documents/${type}-${encodeURIComponent(id)}`, { method: 'DELETE' });
      } else if (model === 'BusinessPartner') await this.onPartnerCreated({ partnerId: id });
      else if (model === 'Contract') await this.onContractCreated({ contractId: id });
      else if (model === 'Invoice') await this.onInvoiceCreated({ invoiceId: id });
      else if (model === 'Opportunity') await this.onOpportunityCreated({ opportunityId: id });
      else if (model === 'Contact') {
        const c = await this.prisma.contact.findUniqueOrThrow({ where: { id }, include: { partner: true } });
        await this.upsert([{ id: `contact-${id}`, type, entityId: id, companyId: c.partner.companyId, title: `${c.firstName} ${c.lastName}`, subtitle: c.partner.name, link: '/crm/partners', text: [c.email, c.position, c.phone].filter(Boolean).join(' ') }]);
      } else if (model === 'Employee') {
        const e = await this.prisma.employee.findUniqueOrThrow({ where: { id } });
        await this.upsert([{ id: `employee-${id}`, type, entityId: id, companyId: e.companyId, title: `${e.firstName} ${e.lastName}`, subtitle: e.discipline, link: `/hr/employees/${id}`, text: [e.employeeNumber, e.workEmail].filter(Boolean).join(' ') }]);
      } else if (model === 'Asset') {
        const a = await this.prisma.asset.findUniqueOrThrow({ where: { id } });
        await this.upsert([{ id: `asset-${id}`, type, entityId: id, companyId: a.companyId, title: a.name, subtitle: a.assetNumber, link: `/assets/${id}`, text: [a.serialNumber, a.manufacturer, a.model].filter(Boolean).join(' ') }]);
      } else if (model === 'KnowledgeArticle') {
        const a = await this.prisma.knowledgeArticle.findUniqueOrThrow({ where: { id } });
        await this.upsert([{ id: `article-${id}`, type, entityId: id, companyId: 'shared', title: a.title, subtitle: a.type, link: '/knowledge', text: a.content.slice(0, 3000) }]);
      }
      if (model === 'BusinessPartner') {
        const contacts = await this.prisma.contact.findMany({ where: { partnerId: id }, select: { id: true } });
        for (const contact of contacts) await this.syncRecord('Contact', contact.id);
      }
    } catch (error) { this.logger.warn(`record search synchronization failed: ${String(error)}`); }
  }

  @OnEvent('crm.partner.created')
  async onPartnerCreated(payload: { partnerId: string }) {
    const p = await this.prisma.businessPartner.findUnique({
      where: { id: payload.partnerId },
    });
    if (!p) return;
    await this.upsert([
      {
        id: `partner-${p.id}`,
        type: 'partner',
        entityId: p.id,
        companyId: p.companyId,
        title: p.name,
        subtitle: `${p.partnerNumber} · ${p.city ?? ''}`,
        link: `/crm/partners/${p.id}`,
        text: [p.legalName, p.vatId].filter(Boolean).join(' '),
      },
    ]);
  }

  @OnEvent('contracts.contract.created')
  async onContractCreated(payload: { contractId: string }) {
    const c = await this.prisma.contract.findUnique({
      where: { id: payload.contractId },
      include: { partner: { select: { name: true } } },
    });
    if (!c) return;
    await this.upsert([
      {
        id: `contract-${c.id}`,
        type: 'contract',
        entityId: c.id,
        companyId: c.companyId,
        title: c.title,
        subtitle: `${c.contractNumber} · ${c.partner?.name ?? ''}`,
        link: `/contracts`,
        text: c.description,
      },
    ]);
  }

  @OnEvent('finance.invoice.created')
  async onInvoiceCreated(payload: { invoiceId: string }) {
    const i = await this.prisma.invoice.findUnique({
      where: { id: payload.invoiceId },
      include: { partner: { select: { name: true } } },
    });
    if (!i) return;
    await this.upsert([
      {
        id: `invoice-${i.id}`,
        type: 'invoice',
        entityId: i.id,
        companyId: i.companyId,
        title: i.invoiceNumber,
        subtitle: `${i.partner.name} · ${i.grossAmount} ${i.currencyCode}`,
        link: `/finance/invoices/${i.id}`,
        text: [i.externalNumber, i.reference].filter(Boolean).join(' '),
      },
    ]);
  }

  @OnEvent('sales.opportunity.created')
  async onOpportunityCreated(payload: { opportunityId: string }) {
    const o = await this.prisma.opportunity.findUnique({
      where: { id: payload.opportunityId },
      include: { partner: { select: { name: true } } },
    });
    if (!o) return;
    await this.upsert([
      {
        id: `opportunity-${o.id}`,
        type: 'opportunity',
        entityId: o.id,
        companyId: o.companyId,
        title: o.title,
        subtitle: `${o.opportunityNumber} · ${o.partner.name}`,
        link: `/sales/pipeline`,
        text: o.description,
      },
    ]);
  }
}
