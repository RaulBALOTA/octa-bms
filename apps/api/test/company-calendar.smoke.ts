import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

/** Read-only localhost smoke test. Local signing material never leaves process memory. */
async function main() {
  const db = new PrismaClient();
  try {
    const user = await db.user.findFirst({ where: { isSystemAdmin: true, isActive: true, deletedAt: null }, include: { memberships: true } });
    if (!user || !user.memberships.length) throw new Error('No active local admin with company membership');
    const token = new JwtService({ secret: process.env.JWT_SECRET ?? 'dev-only-secret' }).sign({ sub: user.id, email: user.email, type: 'access' }, { expiresIn: '1m' });
    const base = 'http://127.0.0.1:3000/api/v1/business-calendar/';
    assert.equal((await fetch(base + 'items')).status, 401);
    for (const path of ['capabilities', 'members', 'items', 'horizon']) {
      const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': user.memberships[0].companyId } });
      const body = await response.json(); assert.equal(response.status, 200, `${path} failed`);
      if (path === 'capabilities') assert.equal(body.enabled, true);
      console.log(`${path}: 200${path === 'capabilities' ? ', enabled=true' : ''}`);
    }
    const unknownCompany = await fetch(base + 'items', { headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': 'calendar-nonexistent-company' } });
    assert.equal(unknownCompany.status, 403); console.log('Unauthenticated and invalid-company requests denied');
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Smoke test failed'); process.exitCode = 1; });
