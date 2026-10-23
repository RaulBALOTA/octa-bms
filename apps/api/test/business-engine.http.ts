/**
 * Business Engine end-to-end verification against a running API and PostgreSQL.
 *
 *   pnpm exec tsx --env-file=.env test/business-engine.http.ts [http://localhost:3000]
 *
 * Creates tracked temporary fixtures (company, users, roles, partners, contract, opportunity,
 * invoice, bank account), exercises the HTTP API through the real guards, and removes everything
 * it created. Never run against production.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const BASE = `${process.argv[2] ?? process.env.API_URL ?? 'http://localhost:3000'}/api/v1`;
const db = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
const password = `Engine-Test-${randomUUID()}`;
const created = { companyId: '', userIds: [] as string[], roleIds: [] as string[], skillIdsBefore: new Set<string>() };
let token = ''; let restrictedToken = '';

async function call<T = unknown>(method: string, path: string, body?: unknown, as: 'full' | 'restricted' = 'full', expect = 200): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${as === 'full' ? token : restrictedToken}`, 'X-Company-Id': created.companyId },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const accepted = expect === 200 ? res.status >= 200 && res.status < 300 : res.status === expect;
  assert.ok(accepted, `${method} ${path} → ${res.status} (expected ${expect}): ${text.slice(0, 400)}`);
  try { return JSON.parse(text) as T; } catch { return text as T; }
}
async function poll<T extends { status: string }>(path: string, done: (x: T) => boolean, timeoutMs = 60_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const row = await call<T>('GET', path);
    if (done(row)) return row;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${path} (${row.status})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}
const login = async (email: string) => (await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json() as { accessToken: string }).accessToken;

async function setup() {
  created.skillIdsBefore = new Set((await db.skill.findMany({ select: { id: true } })).map((s) => s.id));
  const company = await db.company.create({ data: { code: `ENG-${nonce}`, name: `Engine verification ${nonce}` } });
  created.companyId = company.id;
  const permissions = await db.permission.findMany({ where: { module: 'engine' } });
  assert.ok(permissions.length >= 48, 'engine.* permissions are installed');
  const fullRole = await db.role.create({ data: { code: `ENG-FULL-${nonce}`, name: 'Engine full (test)', permissions: { create: permissions.map((p) => ({ permissionId: p.id })) } } });
  const limited = permissions.filter((p) => ['engine.resources.read', 'engine.portfolio.read', 'engine.services.read'].includes(p.code));
  const pmRole = await db.role.create({ data: { code: `ENG-PM-${nonce}`, name: 'Engine project manager (test)', permissions: { create: limited.map((p) => ({ permissionId: p.id })) } } });
  created.roleIds.push(fullRole.id, pmRole.id);
  const hash = await argon2.hash(password);
  for (const [email, roleId] of [[`engine-full-${nonce}@example.invalid`, fullRole.id], [`engine-pm-${nonce}@example.invalid`, pmRole.id]] as const) {
    const user = await db.user.create({ data: { email, firstName: 'Temporary', lastName: 'Verification', passwordHash: hash, memberships: { create: { companyId: company.id, isDefault: true } },
      userRoles: { create: { roleId, companyId: company.id } } } });
    created.userIds.push(user.id);
  }
  token = await login(`engine-full-${nonce}@example.invalid`);
  restrictedToken = await login(`engine-pm-${nonce}@example.invalid`);
  assert.ok(token && restrictedToken, 'login works');
  const client = await db.businessPartner.create({ data: { companyId: company.id, partnerNumber: `C-${nonce}`, type: 'CLIENT', name: 'Synthetic Food Plant GmbH', paymentTermDays: 30 } });
  const type = await db.contractTypeRef.findFirst() ?? await db.contractTypeRef.create({ data: { code: `TEST-${nonce}`, name: 'Test', category: 'CLIENT' } });
  const contract = await db.contract.create({ data: { companyId: company.id, partnerId: client.id, contractTypeId: type.id, contractNumber: `CT-${nonce}`, title: 'Plant expansion PM', status: 'ACTIVE', value: 120000 } });
  const opportunity = await db.opportunity.create({ data: { companyId: company.id, partnerId: client.id, opportunityNumber: `OP-${nonce}`, title: 'Line 4 tendering', stage: 'PROPOSAL', probability: 60 } });
  const employee = await db.employee.create({ data: { companyId: company.id, employeeNumber: `E-${nonce}`, firstName: 'Synthetic', lastName: 'Engineer', weeklyHours: 40 } });
  await db.invoice.create({ data: { companyId: company.id, partnerId: client.id, direction: 'OUTGOING', status: 'SENT', invoiceNumber: `R-${nonce}`, invoiceDate: new Date(), dueDate: new Date(Date.now() - 45 * 86_400_000),
    netAmount: 10000, taxAmount: 1900, grossAmount: 11900, contractId: contract.id } });
  await db.bankAccount.create({ data: { companyId: company.id, name: 'Test account', iban: `DE00TEST${nonce}`, openingBalance: 50000 } });
  return { client, contract, opportunity, employee };
}

async function cleanup() {
  const c = created.companyId;
  if (c) {
    const q = (sql: string) => db.$executeRawUnsafe(sql, c);
    for (const t of ['engine_decisions', 'engine_recommendations', 'engine_actions', 'engine_alerts', 'engine_recalibrations', 'engine_optimization_runs', 'engine_scenarios']) await q(`DELETE FROM "${t}" WHERE "companyId" = $1`);
    await q(`DELETE FROM "engine_demands" WHERE "assignmentId" IN (SELECT id FROM "engine_assignments" WHERE "companyId" = $1)`);
    await q(`DELETE FROM "engine_assignments" WHERE "companyId" = $1`);
    await q(`DELETE FROM "engine_package_items" WHERE "packageId" IN (SELECT id FROM "engine_packages" WHERE "companyId" = $1)`);
    await q(`DELETE FROM "engine_packages" WHERE "companyId" = $1`);
    await q(`DELETE FROM "engine_services" WHERE "companyId" = $1`);
    await q(`DELETE FROM "engine_resources" WHERE "companyId" = $1`);
    await q(`DELETE FROM "engine_settings" WHERE "companyId" = $1`);
    await q(`DELETE FROM "payments" WHERE "bankAccountId" IN (SELECT id FROM "bank_accounts" WHERE "companyId" = $1)`);
    await q(`DELETE FROM "bank_accounts" WHERE "companyId" = $1`);
    await q(`DELETE FROM "invoices" WHERE "companyId" = $1`);
    await q(`DELETE FROM "contracts" WHERE "companyId" = $1`);
    await q(`DELETE FROM "opportunities" WHERE "companyId" = $1`);
    await q(`DELETE FROM "employees" WHERE "companyId" = $1`);
    await q(`DELETE FROM "business_partners" WHERE "companyId" = $1`);
    await db.notification.deleteMany({ where: { userId: { in: created.userIds } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: created.userIds } } });
    await db.userRole.deleteMany({ where: { userId: { in: created.userIds } } });
    await db.companyMembership.deleteMany({ where: { userId: { in: created.userIds } } });
    await db.auditLog.deleteMany({ where: { companyId: c } });
    await db.auditLog.deleteMany({ where: { userId: { in: created.userIds } } });
    await db.user.deleteMany({ where: { id: { in: created.userIds } } });
    await db.rolePermission.deleteMany({ where: { roleId: { in: created.roleIds } } });
    await db.role.deleteMany({ where: { id: { in: created.roleIds } } });
    await q(`DELETE FROM "companies" WHERE id = $1`);
  }
  // Skills created by the template run (shared catalog) are removed only if unreferenced.
  const newSkills = (await db.skill.findMany({ select: { id: true } })).map((s) => s.id).filter((id) => !created.skillIdsBefore.has(id));
  for (let pass = 0; pass < 4; pass++) for (const id of newSkills) await db.skill.delete({ where: { id } }).catch(() => undefined);
}

async function main() {
  const { client, contract, opportunity } = await setup();

  // Phase 1 — catalog, templates, skills, resources, confidentiality
  const applied = await call<{ services: number; packages: number }>('POST', '/engine/templates/apply');
  assert.equal(applied.services, 52); assert.equal(applied.packages, 7);
  assert.equal((await call<{ services: number }>('POST', '/engine/templates/apply')).services, 0, 'templates are idempotent');
  const services = await call<{ id: string; code: string; requirements: { costRate: unknown }[] }[]>('GET', '/engine/services');
  const pm = services.find((s) => s.code === 'B-PM') as { id: string; code: string };
  const svc = await call<{ id: string; version: number; lifecycle: string }>('GET', `/engine/services/${pm.id}`);
  await call('POST', `/engine/services/${pm.id}/lifecycle`, { toState: 'COMMERCIAL', reason: 'Validated with first client' });
  await call('POST', `/engine/services/${pm.id}/lifecycle`, { toState: 'PROPOSED' }, 'full', 400);
  assert.equal((await call<{ lifecycleEvents: unknown[] }>('GET', `/engine/services/${pm.id}`)).lifecycleEvents.length, 2, 'lifecycle history retained');
  assert.equal(svc.version, 1);
  const imported = await call<{ created: number }>('POST', '/engine/resources/import-employees');
  assert.equal(imported.created, 1);
  const [resource] = await call<{ id: string }[]>('GET', '/engine/resources');
  await call('POST', `/engine/resources/${resource.id}/rates`, { effectiveFrom: '2020-01-01', costRate: '70.00', monthlyFixedCost: '7000.00' });
  await call('POST', `/engine/resources/${resource.id}/rates`, { effectiveFrom: '2020-01-01', costRate: '71.00' }, 'full', 409);
  const asPm = await call<{ rates: unknown[]; ratesRedacted: boolean }[]>('GET', '/engine/resources', undefined, 'restricted');
  assert.deepEqual([asPm[0].rates.length, asPm[0].ratesRedacted], [0, true], 'project managers do not see personnel cost rates');
  await call('POST', `/engine/resources/${resource.id}/rates`, { effectiveFrom: '2021-01-01', costRate: '75.00' }, 'restricted', 403);

  // Phase 2 — assignments on existing contract / opportunity records
  await call('POST', '/engine/assignments', { clientId: client.id, serviceId: pm.id, title: 'No anchor', startDate: '2027-01-04', endDate: '2027-06-30', feeModel: 'FIXED_FEE', fixedFee: '1', billing: 'MONTHLY' }, 'full', 400);
  await call('POST', '/engine/assignments', { clientId: client.id, contractId: contract.id, serviceId: pm.id, title: 'Missing fee', startDate: '2027-01-04', endDate: '2027-06-30', feeModel: 'FIXED_FEE', billing: 'MONTHLY' }, 'full', 400);
  const start = new Date(); const s = (d: number) => new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  const contracted = await call<{ id: string; demands: { hours: string; source: string }[] }>('POST', '/engine/assignments', { clientId: client.id, contractId: contract.id, serviceId: pm.id,
    title: 'Plant expansion — project management', startDate: s(0), endDate: s(180), feeModel: 'FIXED_FEE', fixedFee: '120000.00', billing: 'MONTHLY', externalProjectRef: `PMO-${nonce}` });
  assert.equal(contracted.demands[0].source, 'TEMPLATE');
  const [pkg] = (await call<{ id: string; code: string }[]>('GET', '/engine/packages')).filter((p) => p.code === 'PKG-TENDER');
  const fromPackage = await call<{ created: string[] }>('POST', `/engine/assignments/from-package/${pkg.id}`, { clientId: client.id, opportunityId: opportunity.id, serviceId: pm.id, title: 'Line 4 tendering',
    startDate: s(30), endDate: s(150), feeModel: 'TIME_AND_MATERIALS', hourlyRate: '115.00', billing: 'MONTHLY' });
  assert.equal(fromPackage.created.length, 6);
  const economics = await call<{ economics: { revenue: string; commitment: string; invoicedNet: string } }>('GET', `/engine/assignments/${contracted.id}/economics`);
  assert.deepEqual([economics.economics.revenue, economics.economics.commitment, economics.economics.invoicedNet], ['120000.00', 'CONTRACTED', '10000.00']);
  await call('GET', `/engine/assignments/${contracted.id}/economics`, undefined, 'restricted', 403);
  await call('POST', `/engine/assignments/${contracted.id}/forecast-versions`, { kind: 'CONTRACT_BASELINE', note: 'Signed' });

  // Phase 3/4 — cockpit, capacity without money, cash
  const overview = await call<{ result: { totals: Record<string, unknown>; cash: { opening: string; minBalance: string }; capacity: { skills: unknown[] } }; definitions: Record<string, unknown> }>('GET', '/engine/analytics/overview?mode=EXPECTED');
  assert.equal(overview.result.totals.backlog, '120000.00', 'backlog = revenue − earned to date (invoicing affects cash only)');
  assert.ok(Number(overview.result.totals.pipelineWeighted) > 0);
  assert.equal(overview.result.cash.opening, '50000.00');
  assert.ok(overview.definitions.backlog, 'KPIs carry definitions');
  await call('GET', '/engine/analytics/overview', undefined, 'restricted', 403);
  const capacity = await call<Record<string, unknown>>('GET', '/engine/analytics/capacity', undefined, 'restricted');
  assert.ok(!JSON.stringify(capacity).includes('"revenue"') && !JSON.stringify(capacity).includes('costRate'), 'capacity view contains no money');
  const csv = await call<string>('GET', '/engine/analytics/reports/service-profitability?mode=CONTRACTED');
  assert.match(csv, /# Service profitability/); assert.match(csv, /ILLUSTRATIVE/);

  // Settings — validation, confirmation
  const settings = await call<{ version: number }>('GET', '/engine/settings');
  await call('PUT', '/engine/settings', { config: { vat: { ratePct: 300 } } }, 'full', 400);
  const saved = await call<{ version: number; config: { illustrative: boolean } }>('PUT', '/engine/settings', { config: { overhead: { monthly: [{ category: 'Office', amount: '4000.00' }], allocation: { method: 'PERCENT_OF_REVENUE', value: '10' } } }, confirm: true, expectedVersion: settings.version });
  assert.equal(saved.config.illustrative, false);

  // Phase 5 — scenarios (isolated), runs, reproducibility, Monte Carlo, comparison
  const before = await db.engineAssignment.count({ where: { companyId: created.companyId } });
  const scenario = await call<{ id: string }>('POST', '/engine/scenarios', { name: 'Win line 4 + hire', mode: 'EXPECTED', operations: [
    { type: 'WIN', opportunityId: opportunity.id }, { type: 'HIRE', name: 'Senior PM', skillIds: [], weeklyHours: 40, start: s(14), monthlyFixedCost: '8000.00', costRate: '72.00' }] });
  await call('POST', '/engine/scenarios', { name: 'bad', mode: 'EXPECTED', operations: [{ type: 'LOSE' }] }, 'full', 400);
  const run = await call<{ id: string; status: string; result: { metrics: { revenue: string }; baselineMetrics: { revenue: string } } }>('POST', `/engine/scenarios/${scenario.id}/runs`, { kind: 'DETERMINISTIC' });
  assert.equal(run.status, 'SUCCEEDED');
  assert.ok(Number(run.result.metrics.revenue) > Number(run.result.baselineMetrics.revenue));
  assert.equal(await db.engineAssignment.count({ where: { companyId: created.companyId } }), before, 'simulation does not mutate live data');
  assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).stage, 'PROPOSAL');
  assert.equal((await call<{ identical: boolean }>('POST', `/engine/scenario-runs/${run.id}/verify`)).identical, true, 'stored run is reproducible');
  const mc = await call<{ id: string }>('POST', `/engine/scenarios/${scenario.id}/runs`, { kind: 'MONTE_CARLO', iterations: 40, seed: 11 });
  const mcDone = await poll<{ status: string; result: { iterations: number; labelling: string } }>(`/engine/scenario-runs/${mc.id}`, (r) => r.status !== 'RUNNING');
  assert.deepEqual([mcDone.status, mcDone.result.iterations, mcDone.result.labelling], ['SUCCEEDED', 40, 'SIMULATED']);
  const sens = await call<{ id: string }>('POST', `/engine/scenarios/${scenario.id}/runs`, { kind: 'SENSITIVITY', parameter: 'PRICE', steps: [-10, 0, 10], includeContracted: true });
  assert.equal((await poll<{ status: string }>(`/engine/scenario-runs/${sens.id}`, (r) => r.status !== 'RUNNING')).status, 'SUCCEEDED');
  const compare = await call<{ rows: { key: string; deltas: unknown[] }[] }>('POST', '/engine/scenario-compare', { scenarioIds: [scenario.id], mode: 'EXPECTED' });
  assert.ok(compare.rows.find((r) => r.key === 'revenue'));

  // Phase 6 — optimization
  const opt = await call<{ id: string }>('POST', '/engine/optimizations', { name: 'Test', cashConstraint: false, timeLimitSeconds: 5 });
  const optDone = await poll<{ status: string; result: { candidates: unknown[]; solver: string } }>(`/engine/optimizations/${opt.id}`, (r) => r.status !== 'RUNNING');
  assert.ok(['OPTIMAL', 'FEASIBLE', 'INFEASIBLE'].includes(optDone.status), `solver status ${optDone.status}`);
  assert.match(optDone.result.solver, /HiGHS/);

  // Phase 7 — monitoring, PMO sync, alerts dedupe, actions
  const pmo = await call<{ applied: boolean }>('PUT', '/engine/integrations/pmo/progress', { externalProjectRef: `PMO-${nonce}`, serviceCode: 'B-PM', asOf: s(0), actualHours: 1500, remainingHours: 600, percentComplete: 60 });
  assert.equal(pmo.applied, true);
  assert.equal((await call<{ applied: boolean }>('PUT', '/engine/integrations/pmo/progress', { externalProjectRef: `PMO-${nonce}`, serviceCode: 'B-PM', asOf: s(-10), actualHours: 1 })).applied, false, 'stale PMO updates are ignored');
  await call('PUT', '/engine/integrations/pmo/progress', { externalProjectRef: 'UNKNOWN', serviceCode: 'B-PM', asOf: s(0) }, 'full', 404);
  const scan1 = await call<{ created: number }>('POST', '/engine/intelligence/alerts/scan');
  const scan2 = await call<{ created: number }>('POST', '/engine/intelligence/alerts/scan');
  assert.ok(scan1.created >= 2, `alerts detected (${scan1.created})`); assert.equal(scan2.created, 0, 'alerts are deduplicated');
  const alerts = await call<{ id: string; ruleCode: string }[]>('GET', '/engine/intelligence/alerts');
  assert.ok(alerts.some((a) => a.ruleCode === 'HOURS_OVERRUN') && alerts.some((a) => a.ruleCode === 'COLLECTION_OVERDUE'), alerts.map((a) => a.ruleCode).join(','));
  await call('POST', '/engine/intelligence/actions', { kind: 'REFORECAST', title: 'Reforecast PM effort', alertId: alerts[0].id });

  // Phase 8 — recommendations without AI, decision workflow with approval rights
  const recs = await call<{ generated: number }>('POST', '/engine/intelligence/recommendations/generate');
  assert.ok(recs.generated >= 1);
  const decision = await call<{ id: string }>('POST', '/engine/intelligence/decisions', { title: 'Hire senior PM', scenarioId: scenario.id });
  await call('POST', `/engine/intelligence/decisions/${decision.id}/status`, { status: 'APPROVED' }, 'full', 400);
  await call('POST', `/engine/intelligence/decisions/${decision.id}/status`, { status: 'UNDER_REVIEW' });
  await call('POST', `/engine/intelligence/decisions/${decision.id}/status`, { status: 'APPROVED' });
  const decisions = await call<{ events: unknown[]; expectedImpact: unknown }[]>('GET', '/engine/intelligence/decisions');
  assert.equal(decisions[0].events.length, 3); assert.ok(decisions[0].expectedImpact, 'expected impact captured from scenario');
  const advisor = await call<{ enabled: boolean }>('GET', '/engine/intelligence/advisor');
  if (!advisor.enabled) await call('POST', '/engine/intelligence/advisor/analyze', {}, 'full', 503); // Case I: AI off, engine fully functional
  const tool = await call<{ resources: { id: string; kind: string }[] }>('GET', '/engine/intelligence/advisor/tools/resource-capacity');
  assert.ok(!JSON.stringify(tool).includes('Synthetic Engineer'), 'advisor tools pseudonymise people');

  // Tenant isolation
  const foreign = await db.company.findFirst({ where: { id: { not: created.companyId } }, select: { id: true } });
  if (foreign) {
    const res = await fetch(`${BASE}/engine/assignments/${contracted.id}`, { headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': foreign.id } });
    assert.equal(res.status, 403, 'non-members cannot switch into another company');
  }
  console.log('Business engine HTTP verification passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await cleanup().catch((e) => console.error('Cleanup failed', e)); await db.$disconnect(); });
