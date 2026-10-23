import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { jwtSecret } from '../src/core/auth/jwt-secret';

/**
 * Cross-company isolation through the real HTTP stack (JWT → company context →
 * permissions → handler) against PostgreSQL. A company administrator of A who
 * holds every permission must not read or change records of company B by id.
 *
 * Start the API first (same DATABASE_URL and JWT_SECRET), then:
 *   DATABASE_URL=... pnpm --filter @octa-bms/api test:tenant:postgres
 */
const API = process.env.API_TEST_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const db = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
const companyIds: string[] = [];
const userIds: string[] = [];
let roleId: string | undefined;
let contractTypeId: string | undefined;

async function main() {
  try {
    const a = await db.company.create({ data: { code: `ISO-A-${nonce}`, name: 'Isolation test A' } }); companyIds.push(a.id);
    const b = await db.company.create({ data: { code: `ISO-B-${nonce}`, name: 'Isolation test B' } }); companyIds.push(b.id);

    // company A administrator: every permission, but scoped to company A only
    const admin = await db.user.create({ data: { email: `iso-admin-${nonce}@example.invalid`, firstName: 'Admin', lastName: 'A' } }); userIds.push(admin.id);
    const outsider = await db.user.create({ data: { email: `iso-b-${nonce}@example.invalid`, firstName: 'User', lastName: 'B' } }); userIds.push(outsider.id);
    await db.companyMembership.create({ data: { userId: admin.id, companyId: a.id, isDefault: true } });
    await db.companyMembership.create({ data: { userId: outsider.id, companyId: b.id, isDefault: true } });
    const permissions = await db.permission.findMany({ select: { id: true } });
    assert.ok(permissions.length > 0, 'Run the seed first so permissions exist');
    const role = await db.role.create({ data: { code: `ISO-ALL-${nonce}`, name: 'Isolation all permissions', permissions: { create: permissions.map((p) => ({ permissionId: p.id })) } } });
    roleId = role.id;
    await db.userRole.create({ data: { userId: admin.id, roleId: role.id, companyId: a.id } });

    // company B records
    const partnerB = await db.businessPartner.create({ data: { companyId: b.id, partnerNumber: `C-B-${nonce}`, type: 'CLIENT', name: 'Foreign client' } });
    const contactB = await db.contact.create({ data: { partnerId: partnerB.id, firstName: 'Foreign', lastName: 'Contact', isPrimary: true } });
    const contractType = await db.contractTypeRef.create({ data: { code: `ISO-${nonce}`, name: 'Isolation', category: 'CLIENT' } });
    contractTypeId = contractType.id;
    const contractB = await db.contract.create({ data: { companyId: b.id, contractTypeId: contractType.id, contractNumber: `CT-B-${nonce}`, title: 'Foreign contract', value: '1000.00' } });
    const obligationB = await db.contractObligation.create({ data: { contractId: contractB.id, title: 'Foreign obligation' } });
    const milestoneB = await db.paymentMilestone.create({ data: { contractId: contractB.id, title: 'Foreign milestone', amount: '100.00' } });
    const claimB = await db.claim.create({ data: { contractId: contractB.id, claimNumber: 'CL-01', title: 'Foreign claim', direction: 'INBOUND' } });
    const voB = await db.variationOrder.create({ data: { contractId: contractB.id, voNumber: 'VO-01', title: 'Foreign VO', amount: '500.00' } });
    const employeeB = await db.employee.create({ data: { companyId: b.id, employeeNumber: `E-B-${nonce}`, firstName: 'Foreign', lastName: 'Employee' } });
    const leaveB = await db.leaveRequest.create({ data: { employeeId: employeeB.id, type: 'SPECIAL', startDate: new Date('2030-01-07'), endDate: new Date('2030-01-08'), days: '2' } });
    const meetingB = await db.meetingMinute.create({ data: { companyId: b.id, title: 'Foreign meeting', meetingDate: new Date(), content: '-' } });
    const taskB = await db.task.create({ data: { title: 'Foreign action', assigneeId: outsider.id, creatorId: outsider.id, entityType: 'meeting', entityId: meetingB.id } });
    const costCenterB = await db.costCenter.create({ data: { companyId: b.id, code: `CC-${nonce}`, name: 'Foreign cost center' } });

    // company A control records
    const partnerA = await db.businessPartner.create({ data: { companyId: a.id, partnerNumber: `C-A-${nonce}`, type: 'CLIENT', name: 'Own client' } });
    const contactA = await db.contact.create({ data: { partnerId: partnerA.id, firstName: 'Own', lastName: 'Contact' } });

    const token = new JwtService().sign({ sub: admin.id, email: admin.email, type: 'access' }, { secret: jwtSecret(), expiresIn: '5m' });
    const call = async (method: string, path: string, body?: unknown, companyId = a.id) => {
      const res = await fetch(`${API}/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => undefined) as any };
    };
    const expectStatus = async (expected: number, method: string, path: string, body?: unknown) => {
      const res = await call(method, path, body);
      assert.equal(res.status, expected, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
      return res;
    };

    // positive control: own company works
    await expectStatus(200, 'PATCH', `/crm/contacts/${contactA.id}`, { notes: 'own' });
    // the company context itself is enforced
    assert.equal((await call('GET', '/hr/leave-requests', undefined, b.id)).status, 403);

    // by-id access to company B is refused as not found
    await expectStatus(404, 'PATCH', `/crm/contacts/${contactB.id}`, { lastName: 'Hijacked', isPrimary: true });
    await expectStatus(404, 'DELETE', `/crm/contacts/${contactB.id}`);
    await expectStatus(404, 'POST', `/crm/partners/${partnerB.id}/contacts`, { firstName: 'X', lastName: 'Y', isPrimary: true });
    await expectStatus(404, 'POST', `/crm/partners/${partnerB.id}/activities`, { type: 'NOTE', subject: 'x' });
    await expectStatus(404, 'PATCH', `/contracts/obligations/${obligationB.id}/fulfill`);
    await expectStatus(404, 'DELETE', `/contracts/milestones/${milestoneB.id}`);
    await expectStatus(404, 'PATCH', `/contracts/claims/${claimB.id}/status`, { status: 'SETTLED' });
    await expectStatus(404, 'PATCH', `/contracts/variation-orders/${voB.id}/status`, { status: 'APPROVED' });
    await expectStatus(404, 'PATCH', `/hr/employees/${employeeB.id}`, { employeeNumber: 'X', firstName: 'X', lastName: 'Hijacked' });
    await expectStatus(404, 'POST', `/hr/leave-requests/${leaveB.id}/decide`, { decision: 'APPROVED' });
    await expectStatus(404, 'POST', '/hr/leave-requests', { employeeId: employeeB.id, type: 'SPECIAL', startDate: '2030-02-04', endDate: '2030-02-05' });
    await expectStatus(404, 'PATCH', `/communication/meetings/action-items/${taskB.id}/toggle`);
    await expectStatus(404, 'GET', `/identity/users/${outsider.id}`);
    await expectStatus(404, 'PATCH', `/identity/users/${outsider.id}`, { isActive: false });

    // foreign keys into company B are rejected
    await expectStatus(400, 'PUT', '/finance/budgets/plan', { year: 2030, costCenterId: costCenterB.id, category: 'OFFICE', amount: '1' });
    await expectStatus(400, 'PATCH', `/crm/partners/${partnerA.id}`, { accountManagerId: employeeB.id });

    // company admins cannot grant global or other-company roles
    await expectStatus(403, 'POST', '/identity/roles/assign', { userId: admin.id, roleId: role.id });
    await expectStatus(403, 'POST', '/identity/roles/assign', { userId: outsider.id, roleId: role.id, companyId: b.id });

    // lists only show the active company
    const leave = await expectStatus(200, 'GET', '/hr/leave-requests');
    assert.ok(!leave.body.data.some((row: { id: string }) => row.id === leaveB.id), 'leave list leaks company B');
    const users = await expectStatus(200, 'GET', '/identity/users?pageSize=200');
    assert.ok(!users.body.data.some((row: { id: string }) => row.id === outsider.id), 'user list leaks company B');

    // and nothing in company B changed
    assert.equal((await db.contact.findUniqueOrThrow({ where: { id: contactB.id } })).lastName, 'Contact');
    assert.equal((await db.contact.findUniqueOrThrow({ where: { id: contactB.id } })).deletedAt, null);
    assert.equal((await db.contact.count({ where: { partnerId: partnerB.id } })), 1);
    assert.equal((await db.contractObligation.findUniqueOrThrow({ where: { id: obligationB.id } })).isFulfilled, false);
    assert.equal(await db.paymentMilestone.count({ where: { id: milestoneB.id } }), 1);
    assert.equal(String((await db.contract.findUniqueOrThrow({ where: { id: contractB.id } })).value), '1000');
    assert.equal((await db.leaveRequest.findUniqueOrThrow({ where: { id: leaveB.id } })).status, 'REQUESTED');
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: taskB.id } })).status, 'OPEN');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: outsider.id } })).isActive, true);

    console.log('Tenant isolation checks passed: by-id access, foreign keys, role grants and lists are confined to the active company.');
  } finally {
    // Only explicitly tracked temporary fixtures are removed.
    await db.$transaction(async (tx) => {
      const where = { companyId: { in: companyIds } };
      await tx.task.deleteMany({ where: { OR: [{ assigneeId: { in: userIds } }, { creatorId: { in: userIds } }] } });
      await tx.meetingMinute.deleteMany({ where });
      await tx.leaveRequest.deleteMany({ where: { employee: where } });
      await tx.crmActivity.deleteMany({ where: { partner: where } });
      await tx.contact.deleteMany({ where: { partner: where } });
      await tx.contractObligation.deleteMany({ where: { contract: where } });
      await tx.paymentMilestone.deleteMany({ where: { contract: where } });
      await tx.claim.deleteMany({ where: { contract: where } });
      await tx.variationOrder.deleteMany({ where: { contract: where } });
      await tx.contract.deleteMany({ where });
      await tx.budgetLine.deleteMany({ where: { budget: where } });
      await tx.budget.deleteMany({ where });
      await tx.costCenter.deleteMany({ where });
      await tx.employee.deleteMany({ where });
      await tx.businessPartner.deleteMany({ where });
      await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
      await tx.auditLog.deleteMany({ where: { OR: [where, { userId: { in: userIds } }] } });
      await tx.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await tx.companyMembership.deleteMany({ where: { userId: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      if (roleId) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.role.deleteMany({ where: { id: roleId } });
      }
      if (contractTypeId) await tx.contractTypeRef.deleteMany({ where: { id: contractTypeId } });
      await tx.numberSequence.deleteMany({ where });
      await tx.company.deleteMany({ where: { id: { in: companyIds } } });
    });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
