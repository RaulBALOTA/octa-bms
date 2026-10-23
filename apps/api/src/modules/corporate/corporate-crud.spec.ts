import 'reflect-metadata';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, expect, it, vi } from 'vitest';
import { GoalsController, UpdateGoalDto, UpsertGoalDto } from './goals.controller';
import { AnnouncementsController, CreateAnnouncementDto, UpdateAnnouncementDto } from './announcements.controller';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../core/auth/decorators';

const user: AuthUser = { id: 'user', email: 'user@example.com', companyId: 'own', isSystemAdmin: false, permissions: [] };
function setup() {
  const rows = [
    { id: 'own', companyId: 'own' as string | null, title: 'Own', content: 'Text', deletedAt: null as Date | null },
    { id: 'other', companyId: 'other' as string | null, title: 'Other', content: 'Text', deletedAt: null as Date | null },
    { id: 'global', companyId: null as string | null, title: 'Global', content: 'Text', deletedAt: null as Date | null },
  ];
  type Where = { id: string; companyId?: string; OR?: { companyId: string | null }[] };
  const matches = (row: typeof rows[number], where: Where) => row.id === where.id && row.deletedAt === null && (where.OR ? where.OR.some((condition) => row.companyId === condition.companyId) : row.companyId === where.companyId);
  const delegate = {
    findFirst: vi.fn(async ({ where }: { where: Where }) => rows.find((row) => matches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: object }) => ({ id: 'new', ...data })),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<typeof rows[number]> }) => {
      const selected = rows.filter((row) => matches(row, where)); selected.forEach((row) => Object.assign(row, data)); return { count: selected.length };
    }),
  };
  const prisma = { companyGoal: delegate, announcement: delegate } as unknown as PrismaService;
  return { goals: new GoalsController(prisma), announcements: new AnnouncementsController(prisma, new EventEmitter2()), rows };
}

describe('corporate CRUD company boundaries', () => {
  it('creates company goals and announcements with server-owned company and author IDs', async () => {
    const { goals, announcements } = setup();
    await expect(goals.create('own', user, { title: 'New goal', year: 2026 })).resolves.toMatchObject({ companyId: 'own', ownerId: 'user' });
    await expect(announcements.create('own', user, { title: 'New notice', content: 'Text' })).resolves.toMatchObject({ companyId: 'own', authorId: 'user' });
  });
  it('edits and soft deletes a goal in the active company', async () => {
    const { goals, rows } = setup();
    await goals.update('own', 'own', { title: 'Edited' });
    expect(rows[0].title).toBe('Edited');
    await goals.remove('own', 'own');
    expect(rows[0].deletedAt).toBeInstanceOf(Date);
    await expect(goals.get('own', 'own')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('cannot edit or delete another company’s goal even if its ID is known', async () => {
    const { goals, rows } = setup();
    await expect(goals.update('own', 'other', { title: 'Forbidden' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(goals.remove('own', 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(rows[1]).toMatchObject({ title: 'Other', deletedAt: null });
  });
  it('edits and soft deletes own announcements', async () => {
    const { announcements, rows } = setup();
    await announcements.update('own', user, 'own', { title: 'Edited', content: 'Updated content' });
    expect(rows[0]).toMatchObject({ title: 'Edited', content: 'Updated content' });
    await announcements.remove('own', user, 'own');
    expect(rows[0].deletedAt).toBeInstanceOf(Date);
  });
  it('allows reading global notices but reserves global edits for system admins', async () => {
    const { announcements, rows } = setup();
    await expect(announcements.get('own', 'global')).resolves.toMatchObject({ title: 'Global' });
    await expect(announcements.update('own', user, 'global', { title: 'Forbidden' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(announcements.remove('own', user, 'global')).rejects.toBeInstanceOf(NotFoundException);
    await announcements.update('own', { ...user, isSystemAdmin: true }, 'global', { title: 'Admin edit' });
    expect(rows[2].title).toBe('Admin edit');
  });
  it('protects announcements in other companies', async () => {
    const { announcements, rows } = setup();
    await expect(announcements.update('own', user, 'other', { content: 'Forbidden' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(announcements.remove('own', user, 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(rows[1].deletedAt).toBeNull();
  });
});

describe('corporate input validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it.each([UpsertGoalDto, CreateAnnouncementDto])('rejects blank titles on creation for %s', async (metatype) => {
    await expect(pipe.transform({ title: '  ', ...(metatype === UpsertGoalDto ? { year: 2026 } : { content: 'Text' }) }, { type: 'body', metatype })).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([UpdateGoalDto, UpdateAnnouncementDto])('supports partial editing but refuses title null or company reassignment for %s', async (metatype) => {
    await expect(pipe.transform({ title: ' Edited ' }, { type: 'body', metatype })).resolves.toMatchObject({ title: 'Edited' });
    for (const body of [{ title: null }, { companyId: 'other' }]) await expect(pipe.transform(body, { type: 'body', metatype })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('accepts clearing optional goal values while rejecting invalid statuses', async () => {
    await expect(pipe.transform({ description: null, targetValue: null }, { type: 'body', metatype: UpdateGoalDto })).resolves.toMatchObject({ targetValue: null });
    await expect(pipe.transform({ status: 'INVALID' }, { type: 'body', metatype: UpdateGoalDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
