import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BankConnection, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AuthUser } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { paged } from '../../common/pagination';
import { BankProvider, BankProviderCode, BankProviderError, ExternalBankTransaction } from './banking.types';
import { BankTransactionQueryDto, CompleteConsentDto, CreateApiKeyConnectionDto, StartConsentDto } from './banking.dto';
import { CredentialVault } from './credential-vault';
import { EnableBankingProvider } from './providers/enable-banking.provider';
import { QontoProvider } from './providers/qonto.provider';

const DAY = 86_400_000;
/** Re-read this much before the last sync so late bookings and status changes are caught. */
const SYNC_OVERLAP_DAYS = 7;

/** Connection fields safe to return — `credentials` and `consentState` never leave the server. */
const connectionSelect = {
  id: true, provider: true, displayName: true, status: true, accessScope: true,
  aspspName: true, aspspCountry: true, consentExpiresAt: true, lastSyncAt: true,
  lastSyncStatus: true, lastError: true, createdAt: true,
  accounts: {
    where: { deletedAt: null },
    select: { id: true, name: true, iban: true, currencyCode: true, syncedBalance: true, syncedBalanceAt: true },
    orderBy: { name: 'asc' as const },
  },
} satisfies Prisma.BankConnectionSelect;

export interface SyncSummary {
  accounts: number;
  imported: number;
  skippedAccounts: string[];
}

@Injectable()
export class BankingService {
  private readonly logger = new Logger(BankingService.name);
  private readonly vault: CredentialVault;
  private readonly providers: Map<BankProviderCode, BankProvider>;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    this.vault = new CredentialVault(config.get<string>('BANKING_ENCRYPTION_KEY'));
    const providers: BankProvider[] = [
      new QontoProvider(
        config.get<string>('QONTO_API_BASE') || undefined,
        config.get<string>('QONTO_STAGING_TOKEN') || undefined,
      ),
      new EnableBankingProvider(
        config.get<string>('ENABLE_BANKING_APP_ID') || undefined,
        readPem(config.get<string>('ENABLE_BANKING_PRIVATE_KEY')),
        config.get<string>('ENABLE_BANKING_API_BASE') || undefined,
        Number(config.get<string>('BANKING_CONSENT_DAYS')) || 180,
      ),
    ];
    this.providers = new Map(providers.map((p) => [p.info.code, p]));
  }

  enabled() {
    return this.config.get<string>('BANKING_ENABLED') === 'true';
  }

  private requireEnabled() {
    if (!this.enabled()) {
      throw new ServiceUnavailableException('Bank connections are disabled; apply prisma/sql/add_bank_connections.sql and set BANKING_ENABLED=true');
    }
    if (!this.vault.ready) {
      throw new ServiceUnavailableException('BANKING_ENCRYPTION_KEY is missing or not a base64-encoded 32-byte key');
    }
  }

  private provider(code: string): BankProvider {
    const provider = this.providers.get(code as BankProviderCode);
    if (!provider) throw new BadRequestException(`Unknown bank provider ${code}`);
    if (!provider.info.configured) throw new ServiceUnavailableException(`${provider.info.name} is not configured on this server`);
    return provider;
  }

  capabilities() {
    return {
      enabled: this.enabled(),
      encryptionReady: this.vault.ready,
      accessScope: 'READ_ONLY',
      providers: [...this.providers.values()].map((p) => p.info),
    };
  }

  listConnections(companyId: string) {
    this.requireEnabled();
    return this.prisma.bankConnection.findMany({
      where: { companyId, deletedAt: null },
      select: connectionSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async institutions(provider: string, country: string) {
    this.requireEnabled();
    const p = this.provider(provider);
    if (!p.listInstitutions) throw new BadRequestException(`${p.info.name} has no bank list`);
    return this.wrap(() => p.listInstitutions!(country));
  }

  async createApiKeyConnection(companyId: string, user: AuthUser, dto: CreateApiKeyConnectionDto) {
    this.requireEnabled();
    const p = this.provider(dto.provider);
    const credentials = { login: dto.login.trim(), secretKey: dto.secretKey.trim() };
    await this.wrap(() => p.verifyCredentials!(credentials));
    const connection = await this.prisma.bankConnection.create({
      data: {
        companyId,
        provider: p.info.code,
        displayName: dto.displayName,
        status: 'ACTIVE',
        credentials: this.vault.seal(credentials),
        createdById: user.id,
      },
    });
    const sync = await this.syncConnection(connection);
    return { id: connection.id, sync };
  }

  async startConsent(companyId: string, user: AuthUser, dto: StartConsentDto) {
    this.requireEnabled();
    const p = this.provider(dto.provider);
    const state = randomUUID();
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:5180';
    const consent = await this.wrap(() =>
      p.startConsent!({
        aspspName: dto.aspspName,
        aspspCountry: dto.aspspCountry,
        state,
        redirectUrl: `${appUrl}/finance/banking/callback`,
      }),
    );
    const connection = dto.connectionId
      ? await this.prisma.bankConnection.update({
          where: { id: (await this.find(companyId, dto.connectionId)).id },
          data: { consentState: state },
        })
      : await this.prisma.bankConnection.create({
          data: {
            companyId,
            provider: p.info.code,
            displayName: dto.displayName || dto.aspspName,
            aspspName: dto.aspspName,
            aspspCountry: dto.aspspCountry.toUpperCase(),
            status: 'PENDING',
            consentState: state,
            createdById: user.id,
          },
        });
    return { id: connection.id, redirectUrl: consent.redirectUrl };
  }

  async completeConsent(companyId: string, dto: CompleteConsentDto) {
    this.requireEnabled();
    const connection = await this.prisma.bankConnection.findFirst({
      where: { companyId, consentState: dto.state, deletedAt: null },
    });
    if (!connection) throw new NotFoundException('Unknown or already used bank consent');
    const p = this.provider(connection.provider);
    const result = await this.wrap(() => p.completeConsent!(dto.code));
    const updated = await this.prisma.bankConnection.update({
      where: { id: connection.id },
      data: {
        credentials: this.vault.seal(result.credentials),
        consentState: null,
        consentExpiresAt: result.consentExpiresAt,
        status: 'ACTIVE',
        lastError: null,
      },
    });
    const sync = await this.syncConnection(updated);
    return { id: connection.id, sync };
  }

  async sync(companyId: string, id: string) {
    this.requireEnabled();
    return this.syncConnection(await this.find(companyId, id));
  }

  /** Background sync of every active connection; errors are recorded per connection. */
  async syncAll() {
    if (!this.enabled() || !this.vault.ready) return;
    const connections = await this.prisma.bankConnection.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
    });
    for (const connection of connections) {
      await this.syncConnection(connection).catch((error) =>
        this.logger.warn(`bank sync ${connection.id} failed: ${(error as Error).message}`),
      );
    }
  }

  async disconnect(companyId: string, id: string) {
    this.requireEnabled();
    const connection = await this.find(companyId, id);
    if (connection.credentials) {
      const p = this.providers.get(connection.provider as BankProviderCode);
      await p?.revoke?.(this.vault.open(connection.credentials)).catch((error) =>
        this.logger.warn(`bank consent revoke ${id} failed: ${(error as Error).message}`),
      );
    }
    // accounts and imported lines stay as history; they become manual accounts
    await this.prisma.$transaction([
      this.prisma.bankAccount.updateMany({ where: { connectionId: id }, data: { connectionId: null, externalId: null } }),
      this.prisma.bankConnection.update({
        where: { id },
        data: { status: 'REVOKED', credentials: null, consentState: null, deletedAt: new Date() },
      }),
    ]);
    return { id, status: 'REVOKED' };
  }

  async listTransactions(companyId: string, query: BankTransactionQueryDto) {
    this.requireEnabled();
    const where: Prisma.BankTransactionWhereInput = {
      bankAccount: { companyId, deletedAt: null },
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(query.from || query.to
        ? { bookingDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
      ...(query.direction ? { amount: query.direction === 'IN' ? { gt: 0 } : { lt: 0 } } : {}),
      ...(query.q
        ? {
            OR: [
              { counterpartyName: { contains: query.q, mode: 'insensitive' } },
              { remittanceInfo: { contains: query.q, mode: 'insensitive' } },
              { counterpartyIban: { contains: query.q.replace(/\s+/g, ''), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where,
        select: {
          id: true, status: true, bookingDate: true, valueDate: true, amount: true, currencyCode: true,
          counterpartyName: true, counterpartyIban: true, remittanceInfo: true, bankReference: true, paymentId: true,
          bankAccount: { select: { id: true, name: true, iban: true } },
        },
        orderBy: [{ bookingDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.bankTransaction.count({ where }),
    ]);
    return paged(data, total, query);
  }

  // ------------------------------------------------------------------ sync

  private async find(companyId: string, id: string) {
    const connection = await this.prisma.bankConnection.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!connection) throw new NotFoundException('Bank connection not found');
    return connection;
  }

  async syncConnection(connection: BankConnection): Promise<SyncSummary> {
    if (!connection.credentials) throw new ConflictException('Bank connection has no consent yet');
    if (connection.consentExpiresAt && connection.consentExpiresAt < new Date()) {
      await this.prisma.bankConnection.update({
        where: { id: connection.id },
        data: { status: 'EXPIRED', lastSyncStatus: 'ERROR', lastError: 'Bank consent expired — renew it to resume syncing' },
      });
      throw new ConflictException('Bank consent expired — renew it to resume syncing');
    }

    const provider = this.provider(connection.provider);
    const credentials = this.vault.open(connection.credentials);
    const startedAt = new Date();
    const lookbackDays = Number(this.config.get<string>('BANKING_SYNC_LOOKBACK_DAYS')) || 90;
    const since = connection.lastSyncAt
      ? new Date(connection.lastSyncAt.getTime() - SYNC_OVERLAP_DAYS * DAY)
      : new Date(startedAt.getTime() - lookbackDays * DAY);

    try {
      const summary: SyncSummary = { accounts: 0, imported: 0, skippedAccounts: [] };
      for (const external of await provider.listAccounts(credentials)) {
        const accountId = await this.linkAccount(connection, external);
        if (!accountId) {
          summary.skippedAccounts.push(external.iban ?? external.name);
          continue;
        }
        const lines = await provider.listTransactions(credentials, external, since);
        summary.imported += await this.storeTransactions(accountId, lines);
        summary.accounts++;
      }
      await this.prisma.bankConnection.update({
        where: { id: connection.id },
        data: { status: 'ACTIVE', lastSyncAt: startedAt, lastSyncStatus: 'OK', lastError: null },
      });
      return summary;
    } catch (error) {
      const expired = error instanceof BankProviderError && error.consentExpired;
      await this.prisma.bankConnection.update({
        where: { id: connection.id },
        data: { status: expired ? 'EXPIRED' : 'ERROR', lastSyncStatus: 'ERROR', lastError: (error as Error).message.slice(0, 500) },
      });
      throw this.toHttp(error);
    }
  }

  /**
   * Finds or creates the OCTA bank account for a provider account. An existing
   * manual account with the same IBAN in the same company is adopted; an IBAN
   * owned by another company or another live connection is skipped.
   */
  private async linkAccount(
    connection: BankConnection,
    external: Awaited<ReturnType<BankProvider['listAccounts']>>[number],
  ): Promise<string | null> {
    const balance = {
      syncedBalance: external.balance,
      syncedBalanceAt: external.balanceAt,
    };
    const linked = await this.prisma.bankAccount.findFirst({
      where: { connectionId: connection.id, externalId: external.externalId },
    });
    if (linked) {
      await this.prisma.bankAccount.update({ where: { id: linked.id }, data: balance });
      return linked.id;
    }

    const iban = external.iban?.replace(/\s+/g, '').toUpperCase() ?? `${connection.provider}:${external.externalId}`;
    const byIban = await this.prisma.bankAccount.findUnique({ where: { iban } });
    if (byIban) {
      if (byIban.companyId !== connection.companyId || (byIban.connectionId && byIban.connectionId !== connection.id)) {
        this.logger.warn(`bank sync ${connection.id}: IBAN ${iban} belongs to another company or connection — skipped`);
        return null;
      }
      await this.prisma.bankAccount.update({
        where: { id: byIban.id },
        data: { ...balance, connectionId: connection.id, externalId: external.externalId, deletedAt: null, isActive: true },
      });
      return byIban.id;
    }

    const created = await this.prisma.bankAccount.create({
      data: {
        companyId: connection.companyId,
        name: external.name,
        iban,
        bic: external.bic,
        currencyCode: external.currencyCode,
        connectionId: connection.id,
        externalId: external.externalId,
        ...balance,
      },
    });
    return created.id;
  }

  /** Idempotent upsert keyed by (account, externalId). Returns the number of lines written. */
  private async storeTransactions(bankAccountId: string, lines: ExternalBankTransaction[]) {
    // content-hash ids are unstable while a line is pending; re-fetch replaces them
    await this.prisma.bankTransaction.deleteMany({
      where: { bankAccountId, status: 'PENDING', externalId: { startsWith: 'h:' } },
    });
    const voided = lines.filter((line) => line.status === 'VOID').map((line) => line.externalId);
    if (voided.length) {
      await this.prisma.bankTransaction.deleteMany({ where: { bankAccountId, externalId: { in: voided } } });
    }
    const kept = lines.filter((line) => line.status !== 'VOID');
    for (const line of kept) {
      const data = {
        status: line.status,
        bookingDate: line.bookingDate,
        valueDate: line.valueDate,
        amount: line.amount,
        currencyCode: line.currencyCode,
        counterpartyName: line.counterpartyName,
        counterpartyIban: line.counterpartyIban,
        remittanceInfo: line.remittanceInfo,
        bankReference: line.bankReference,
        raw: line.raw as Prisma.InputJsonValue,
      };
      await this.prisma.bankTransaction.upsert({
        where: { bankAccountId_externalId: { bankAccountId, externalId: line.externalId } },
        create: { bankAccountId, externalId: line.externalId, ...data },
        update: data,
      });
    }
    return kept.length;
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  private toHttp(error: unknown) {
    if (error instanceof BankProviderError) {
      return new UnprocessableEntityException({ code: error.consentExpired ? 'BANK_CONSENT_INVALID' : 'BANK_API_ERROR', message: error.message });
    }
    return error;
  }
}

/** Accepts an inline PEM (with literal or escaped newlines) or a path to a .pem file. */
function readPem(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes('-----BEGIN')) return value.replace(/\\n/g, '\n');
  return readFileSync(value, 'utf8');
}
