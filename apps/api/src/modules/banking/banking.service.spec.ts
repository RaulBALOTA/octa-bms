import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BankingService } from './banking.service';
import { BankProviderError } from './banking.types';
import { CredentialVault } from './credential-vault';

const key = randomBytes(32).toString('base64');
const env: Record<string, string> = { BANKING_ENABLED: 'true', BANKING_ENCRYPTION_KEY: key };
const config = { get: (name: string) => env[name] } as any;

function makePrisma(existingAccounts: any[] = []) {
  const accounts = [...existingAccounts];
  return {
    accounts,
    bankConnection: { update: vi.fn(async ({ data }: any) => data), findMany: vi.fn(async () => []) },
    bankAccount: {
      findFirst: vi.fn(async ({ where }: any) => accounts.find((a) => a.connectionId === where.connectionId && a.externalId === where.externalId) ?? null),
      findUnique: vi.fn(async ({ where }: any) => accounts.find((a) => a.iban === where.iban) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(accounts.find((a) => a.id === where.id), data)),
      create: vi.fn(async ({ data }: any) => {
        const account = { id: `ba-${accounts.length + 1}`, ...data };
        accounts.push(account);
        return account;
      }),
    },
    bankTransaction: { deleteMany: vi.fn(async (_args: any) => ({ count: 0 })), upsert: vi.fn(async (_args: any) => ({})) },
  };
}

function service(prisma: any, provider: any) {
  const s = new BankingService(prisma, config);
  (s as any).providers.set('QONTO', provider);
  return s;
}

const connection = (over: any = {}) => ({
  id: 'conn-1', companyId: 'co-1', provider: 'QONTO', status: 'ACTIVE', lastSyncAt: null, consentExpiresAt: null,
  credentials: new CredentialVault(key).seal({ login: 'l', secretKey: 's' }), ...over,
});

const qonto = (accounts: any[], lines: any[]) => ({
  info: { code: 'QONTO', name: 'Qonto', authKind: 'API_KEY', configured: true },
  listAccounts: vi.fn(async () => accounts),
  listTransactions: vi.fn(async (..._args: any[]) => lines),
});

const external = (over: any = {}) => ({ externalId: 'acc-1', name: 'Main', iban: 'FR76 1695 8000 01', bic: null, currencyCode: 'EUR', balance: '10.00', balanceAt: new Date(), ...over });
const line = (id: string, status = 'BOOKED') => ({ externalId: id, status, bookingDate: new Date(), valueDate: null, amount: '1.00', currencyCode: 'EUR', counterpartyName: null, counterpartyIban: null, remittanceInfo: null, bankReference: null, raw: {} });

describe('BankingService.syncConnection', () => {
  it('adopts a manual account with the same IBAN and upserts lines idempotently', async () => {
    const prisma = makePrisma([{ id: 'ba-manual', companyId: 'co-1', iban: 'FR76169580000', connectionId: null }]);
    const provider = qonto([external({ iban: 'FR76169580000' })], [line('t1'), line('t2')]);
    const summary = await service(prisma, provider).syncConnection(connection() as any);

    expect(summary).toEqual({ accounts: 1, imported: 2, skippedAccounts: [] });
    expect(prisma.accounts[0]).toMatchObject({ connectionId: 'conn-1', externalId: 'acc-1', syncedBalance: '10.00' });
    expect(prisma.bankAccount.create).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.bankTransaction.upsert.mock.calls[0][0].where).toEqual({ bankAccountId_externalId: { bankAccountId: 'ba-manual', externalId: 't1' } });
    expect(prisma.bankConnection.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', lastSyncStatus: 'OK' }) }));
  });

  it('never attaches an IBAN that belongs to another company', async () => {
    const prisma = makePrisma([{ id: 'ba-x', companyId: 'co-OTHER', iban: 'FR76169580000', connectionId: null }]);
    const provider = qonto([external({ iban: 'FR76169580000' })], [line('t1')]);
    const summary = await service(prisma, provider).syncConnection(connection() as any);
    expect(summary.skippedAccounts).toEqual(['FR76169580000']);
    expect(provider.listTransactions).not.toHaveBeenCalled();
    expect(prisma.accounts[0].connectionId).toBeNull();
  });

  it('deletes voided lines instead of storing them', async () => {
    const prisma = makePrisma();
    const provider = qonto([external()], [line('t1'), line('t-declined', 'VOID')]);
    const summary = await service(prisma, provider).syncConnection(connection() as any);
    expect(summary.imported).toBe(1);
    expect(prisma.bankTransaction.deleteMany).toHaveBeenCalledWith({ where: { bankAccountId: 'ba-1', externalId: { in: ['t-declined'] } } });
  });

  it('re-reads from 7 days before the last sync', async () => {
    const prisma = makePrisma();
    const provider = qonto([external()], []);
    await service(prisma, provider).syncConnection(connection({ lastSyncAt: new Date('2026-10-20T00:00:00Z') }) as any);
    expect(provider.listTransactions.mock.calls[0][2]).toEqual(new Date('2026-10-13T00:00:00Z'));
  });

  it('marks the connection EXPIRED when the bank rejects the consent', async () => {
    const prisma = makePrisma();
    const provider = qonto([], []);
    provider.listAccounts.mockRejectedValue(new BankProviderError('unauthorized', 401, true));
    await expect(service(prisma, provider).syncConnection(connection() as any)).rejects.toMatchObject({ status: 422 });
    expect(prisma.bankConnection.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }));
  });

  it('refuses to sync after the consent end date', async () => {
    const prisma = makePrisma();
    const provider = qonto([external()], []);
    await expect(service(prisma, provider).syncConnection(connection({ consentExpiresAt: new Date(Date.now() - 1000) }) as any)).rejects.toThrow(/expired/);
    expect(provider.listAccounts).not.toHaveBeenCalled();
  });
});

describe('BankingService.capabilities', () => {
  it('reports read-only access and never exposes secrets', () => {
    const caps = new BankingService(makePrisma() as any, config).capabilities();
    expect(caps).toMatchObject({ enabled: true, encryptionReady: true, accessScope: 'READ_ONLY' });
    expect(caps.providers.map((p) => p.code)).toEqual(['QONTO', 'ENABLE_BANKING']);
    expect(JSON.stringify(caps)).not.toContain(key);
  });
});
