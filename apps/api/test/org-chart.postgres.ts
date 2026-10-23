import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { OrgChartService } from '../src/modules/hr/org-chart.service';
import { RecruitmentController } from '../src/modules/hr/recruitment.controller';
import { StaffingBudgetService } from '../src/modules/hr/staffing-budget.service';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../src/core/prisma/prisma.service';

const db = new PrismaClient();
const chart = new OrgChartService(db as unknown as PrismaService);
const recruitment = new RecruitmentController(db as unknown as PrismaService, chart);
const staffing = new StaffingBudgetService(db as unknown as PrismaService, chart);
const companyIds: string[] = [];
const positionIds: string[] = [];
let userId: string | undefined;
const nonce = randomUUID();
type Snapshot = Awaited<ReturnType<OrgChartService['snapshot']>>;
const snapshotOf = (version: Awaited<ReturnType<OrgChartService['getVersion']>>) => version.snapshot as unknown as Snapshot;

async function main() {
  try {
    const user = await db.user.create({ data: { email: `orgchart-${nonce}@example.invalid`, firstName: 'Temporary', lastName: 'Verification', isSystemAdmin: true } });
    userId = user.id;
    const company = await db.company.create({ data: { code: `ORG-A-${nonce}`, name: 'Temporary org chart test A' } }); companyIds.push(company.id);
    const other = await db.company.create({ data: { code: `ORG-B-${nonce}`, name: 'Temporary org chart test B' } }); companyIds.push(other.id);
    const department = await db.department.create({ data: { companyId: company.id, code: 'ADM', name: 'Business Administration' } });
    const foreignDepartment = await db.department.create({ data: { companyId: other.id, code: 'ADM', name: 'Other company' } });
    const office = await db.office.create({ data: { companyId: company.id, code: 'HQ', name: 'Head office' } });
    const foreignOffice = await db.office.create({ data: { companyId: other.id, code: 'HQ', name: 'Foreign office' } });
    const director = await db.position.create({ data: { code: `MD-${nonce}`, name: 'Managing Director', departmentId: department.id } }); positionIds.push(director.id);
    const shared = await db.position.create({ data: { code: `SHARED-${nonce}`, name: 'Shared specialist' } }); positionIds.push(shared.id);
    const foreign = await db.position.create({ data: { code: `FOREIGN-${nonce}`, name: 'Foreign role', departmentId: foreignDepartment.id } }); positionIds.push(foreign.id);
    const manager = await db.employee.create({ data: { companyId: company.id, employeeNumber: 'MD', firstName: 'Original', lastName: 'Director', departmentId: department.id, positionId: director.id } });
    await db.department.update({ where: { id: department.id }, data: { managerId: manager.id } });

    assert.equal((await chart.positions(company.id)).find((row) => row.id === director.id)?.status, 'FILLED');
    assert.ok(!(await chart.positions(company.id)).some((row) => row.id === foreign.id));
    assert.ok((await recruitment.openPositions(company.id)).some((row) => row.id === shared.id));
    assert.ok(!(await recruitment.openPositions(company.id)).some((row) => row.id === director.id || row.id === foreign.id));
    await assert.rejects(chart.setStatus(company.id, user.id, foreign.id, 'BUDGETED'), NotFoundException);
    await assert.rejects(chart.setStatus(company.id, user.id, director.id, 'OPEN'), ConflictException);
    await assert.rejects(chart.setStatus(company.id, user.id, shared.id, 'FILLED'), BadRequestException);
    assert.equal((await chart.listVersions(company.id)).length, 0);

    await chart.setStatus(company.id, user.id, shared.id, 'BUDGETED');
    assert.equal((await chart.positions(company.id)).find((row) => row.id === shared.id)?.status, 'BUDGETED');
    assert.equal((await chart.positions(other.id)).find((row) => row.id === shared.id)?.status, 'OPEN');
    assert.ok(!(await recruitment.openPositions(company.id)).some((row) => row.id === shared.id));
    assert.ok((await recruitment.openPositions(other.id)).some((row) => row.id === shared.id));
    const automatic = await chart.listVersions(company.id);
    assert.deepEqual(automatic.map((row) => row.version), [2, 1]);
    const before = await chart.getVersion(company.id, automatic[1].id);
    const after = await chart.getVersion(company.id, automatic[0].id);
    assert.equal(snapshotOf(before).positions.find((row) => row.id === shared.id)?.status, 'OPEN');
    assert.equal(snapshotOf(after).positions.find((row) => row.id === shared.id)?.status, 'BUDGETED');
    await chart.setStatus(company.id, user.id, shared.id, 'BUDGETED');
    assert.equal((await chart.listVersions(company.id)).length, 2, 'No-op changes do not create versions');

    const saved = await chart.saveVersion(company.id, user.id, 'Approved organization', '  Initial staffing plan  ');
    assert.equal(saved.version, 3);
    assert.equal(saved.note, 'Initial staffing plan');
    await assert.rejects(chart.getVersion(other.id, saved.id), NotFoundException);
    await db.department.update({ where: { id: department.id }, data: { name: 'Renamed administration' } });
    await db.employee.update({ where: { id: manager.id }, data: { firstName: 'Updated' } });
    const frozen = await chart.getVersion(company.id, saved.id);
    assert.equal(snapshotOf(frozen).departments[0].name, 'Business Administration');
    assert.equal(snapshotOf(frozen).departments[0].managerId, manager.id);
    assert.equal(snapshotOf(frozen).employees[0].firstName, 'Original');

    const occupant = await db.employee.create({ data: { companyId: company.id, employeeNumber: 'SHARED', firstName: 'Temporary', lastName: 'Specialist', positionId: shared.id, departmentId: department.id, managerId: manager.id } });
    assert.equal((await chart.positions(company.id)).find((row) => row.id === shared.id)?.status, 'FILLED');
    assert.ok(!(await recruitment.openPositions(company.id)).some((row) => row.id === shared.id));
    await assert.rejects(chart.setStatus(company.id, user.id, shared.id, 'BUDGETED'), ConflictException);
    const filled = await chart.saveVersion(company.id, user.id, 'Staffed chart');
    assert.equal(filled.version, 4);
    assert.equal(snapshotOf(await chart.getVersion(company.id, filled.id)).positions.find((row) => row.id === shared.id)?.status, 'FILLED');
    await db.employee.update({ where: { id: occupant.id }, data: { status: 'TERMINATED' } });
    assert.equal((await chart.positions(company.id)).find((row) => row.id === shared.id)?.status, 'BUDGETED');
    assert.equal(snapshotOf(await chart.getVersion(company.id, filled.id)).positions.find((row) => row.id === shared.id)?.status, 'FILLED');
    assert.equal((await chart.positions(other.id)).find((row) => row.id === shared.id)?.status, 'OPEN');

    const concurrent = await Promise.all([1, 2, 3].map((number) => chart.saveVersion(company.id, user.id, `Concurrent ${number}`)));
    assert.deepEqual(concurrent.map((row) => row.version).sort(), [5, 6, 7]);
    assert.equal((await chart.listVersions(company.id)).length, 7);
    assert.equal((await chart.listVersions(other.id)).length, 0);
    await chart.setStatus(company.id, user.id, shared.id, 'OPEN');
    assert.ok((await recruitment.openPositions(company.id)).some((row) => row.id === shared.id));
    const job = await recruitment.createOpening(company.id, { title: 'Test job', departmentId: department.id, officeId: office.id });
    assert.equal(job.departmentId, department.id); assert.equal(job.officeId, office.id);
    assert.equal(job.departmentName, 'Renamed administration'); assert.equal(job.officeName, 'Head office');
    await assert.rejects(recruitment.createOpening(company.id, { title: 'Invalid department', departmentId: foreignDepartment.id }), BadRequestException);
    await assert.rejects(recruitment.createOpening(company.id, { title: 'Invalid office', officeId: foreignOffice.id }), BadRequestException);
    const otherJob = await recruitment.createOpening(other.id, { title: 'Other test job' });
    const applicant = await recruitment.addApplicant(company.id, job.id, { firstName: 'Temporary', lastName: 'Applicant', email: 'applicant@example.invalid' });
    assert.ok(!(await recruitment.openings(company.id)).some((row) => row.id === otherJob.id));
    assert.ok(!(await recruitment.board(other.id)).some((column) => column.items.some((row) => row.id === applicant.id)));
    await assert.rejects(recruitment.addApplicant(company.id, otherJob.id, { firstName: 'Wrong', lastName: 'Company', email: 'wrong@example.invalid' }), NotFoundException);
    await assert.rejects(recruitment.updateOpeningStatus(other.id, job.id, { status: 'FILLED' }), NotFoundException);
    await assert.rejects(recruitment.setStage(other.id, applicant.id, { stage: 'INTERVIEW' }), NotFoundException);
    const input = { title: 'Staffing plan', year: 2026, includeOpen: true, includeBudgeted: true, lines: [{
      positionId: shared.id, officeId: office.id, headcount: 1, fte: 0.5, annualSalary: '60000', annualBonus: '0',
      monthlyBenefits: '0', employerCostPct: 20, recruitingCost: '1000', plannedStart: '2026-01-01', forecastStart: '2026-04-01', hiringProbability: 50,
    }] };
    const calculated = await staffing.calculate(company.id, input);
    assert.deepEqual(calculated.result.totals, { budget: '37000.00', forecast: '14000.00', variance: '-23000.00' });
    await assert.rejects(staffing.calculate(company.id, { ...input, lines: [{ ...input.lines[0], officeId: foreignOffice.id }] }), BadRequestException);
    await assert.rejects(staffing.calculate(company.id, { ...input, lines: [{ ...input.lines[0], positionId: foreign.id }] }), BadRequestException);
    await assert.rejects(staffing.calculate(company.id, { ...input, lines: [{ ...input.lines[0], positionId: director.id }] }), BadRequestException);
    await assert.rejects(staffing.calculate(company.id, { ...input, includeOpen: false }), BadRequestException);
    await assert.rejects(staffing.calculate(company.id, { ...input, lines: [input.lines[0], input.lines[0]] }), BadRequestException);
    const scenario = await staffing.save(company.id, user.id, input);
    assert.equal(scenario.version, 1);
    await assert.rejects(staffing.get(other.id, scenario.id), NotFoundException);
    await assert.rejects(staffing.revision(other.id, scenario.id, 1), NotFoundException);
    const edited = { ...input, expectedVersion: 1, lines: [{ ...input.lines[0], annualSalary: '72000' }], note: 'Salary updated' };
    const update = await staffing.save(company.id, user.id, edited, scenario.id);
    assert.equal(update.version, 2);
    assert.equal((update.result as unknown as typeof calculated.result).totals.budget, '44200.00');
    const original = await staffing.revision(company.id, scenario.id, 1);
    assert.equal((original.result as unknown as typeof calculated.result).totals.budget, '37000.00');
    await assert.rejects(staffing.save(company.id, user.id, edited, scenario.id), ConflictException);
    const concurrentPlans = await Promise.allSettled([1, 2].map(() => staffing.save(company.id, user.id, { ...edited, expectedVersion: 2 }, scenario.id)));
    assert.equal(concurrentPlans.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal((await staffing.get(company.id, scenario.id)).revisions.length, 3);
    if (process.argv.includes('--http')) {
      const token = new JwtService().sign({ sub: user.id, email: user.email, type: 'access' }, { secret: process.env.JWT_SECRET ?? 'dev-only-secret', expiresIn: '5m' });
      const request = (path: string, body: unknown) => fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/v1${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': company.id, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const calculatedResponse = await request('/hr/staffing-budgets/calculate', input);
      assert.equal(calculatedResponse.status, 201, `Calculate endpoint: ${JSON.stringify((await calculatedResponse.clone().json() as { message?: unknown }).message)}`);
      const calculatedBody = await calculatedResponse.json() as typeof calculated;
      assert.deepEqual(calculatedBody.result.totals, calculated.result.totals);
      const savedResponse = await request('/hr/staffing-budgets', { ...input, title: 'HTTP verified plan' });
      assert.equal(savedResponse.status, 201, `Save endpoint: ${JSON.stringify((await savedResponse.clone().json() as { message?: unknown }).message)}`);
      const openingResponse = await request('/hr/job-openings', { title: 'HTTP verified opening', departmentId: department.id, officeId: office.id });
      assert.equal(openingResponse.status, 201, `Opening endpoint: ${JSON.stringify((await openingResponse.clone().json() as { message?: unknown }).message)}`);
      const linked = await openingResponse.json() as typeof job;
      assert.equal(linked.departmentId, department.id); assert.equal(linked.officeId, office.id);
      assert.equal((await request('/hr/job-openings', { title: 'Invalid foreign reference', officeId: foreignOffice.id })).status, 400);
      console.log('Running API HTTP checks passed: calculations, saved budgets, company-linked openings and foreign-reference validation.');
    }
    console.log('PostgreSQL checks passed: org chart versions, staffing states, recruitment/company selectors, budgeting/forecast calculations, immutable plan revisions, and concurrent edit protection.');
  } finally {
    // Only explicitly tracked temporary fixtures are removed.
    await db.$transaction(async (tx) => {
      await tx.orgChartVersion.deleteMany({ where: { companyId: { in: companyIds } } });
      await tx.positionPlan.deleteMany({ where: { companyId: { in: companyIds } } });
      await tx.staffingBudgetRevision.deleteMany({ where: { scenario: { companyId: { in: companyIds } } } });
      await tx.staffingBudgetScenario.deleteMany({ where: { companyId: { in: companyIds } } });
      await tx.applicant.deleteMany({ where: { jobOpening: { companyId: { in: companyIds } } } });
      await tx.jobOpening.deleteMany({ where: { companyId: { in: companyIds } } });
      await tx.department.updateMany({ where: { companyId: { in: companyIds } }, data: { managerId: null, parentId: null } });
      await tx.employee.deleteMany({ where: { companyId: { in: companyIds } } });
      await tx.position.deleteMany({ where: { id: { in: positionIds } } });
      await tx.department.deleteMany({ where: { companyId: { in: companyIds } } });
      await tx.office.deleteMany({ where: { companyId: { in: companyIds } } });
      await tx.company.deleteMany({ where: { id: { in: companyIds } } });
      if (userId) await tx.user.delete({ where: { id: userId } });
    });
    await db.$disconnect();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Org chart verification failed'); process.exitCode = 1; });
