import type { EngineConfig, SourcingOptionInput, SourcingOptionResult, SourcingResult } from '../../../../../../packages/shared/src/business-engine';
import { D, Dec, ZERO, dec, money, ratio, round } from './money';

/**
 * Make / buy / partner comparison for a given demand. All costs are explicit inputs or configured
 * assumptions; nothing is inferred from payroll data. Subcontracting never removes OCTA's
 * contractual responsibility towards the client — this is disclosed for every external option.
 */
export function compareSourcing(input: { demandHours: number; billRate: string; requiredWithinWeeks?: number | null; options: SourcingOptionInput[] }, config: EngineConfig): SourcingResult {
  const demand = new D(input.demandHours); const bill = dec(input.billRate);
  const hiring = config.hiring;
  const freelance = input.options.find((o) => o.kind === 'FREELANCE' && o.hourlyCost);
  const results: SourcingOptionResult[] = input.options.map((o) => {
    const reasons: string[] = []; const notes: string[] = [];
    const lead = o.leadTimeWeeks ?? (o.kind === 'HIRE' ? hiring.onboardingWeeks : 0);
    if (input.requiredWithinWeeks !== null && input.requiredWithinWeeks !== undefined && lead > input.requiredWithinWeeks) reasons.push(`Lead time ${lead} weeks exceeds the required ${input.requiredWithinWeeks} weeks`);
    const fixedInvestment = dec(o.fixedInvestment ?? '0');
    const qc = new D(o.qualityControlPct ?? 0).div(100);
    let totalCost: Dec; let effective: Dec; let fixedExposure = fixedInvestment; let deliveredHours = demand;
    let hiringDetail: SourcingOptionResult['hiring'];
    if (o.kind === 'HIRE') {
      if (!o.annualSalary) reasons.push('Annual salary is required for a hiring comparison');
      const weekly = o.weeklyHours ?? 40;
      const employer = dec(o.annualSalary ?? '0').times(new D(1).plus(new D(hiring.employerCostPct).div(100))).plus(dec(o.annualBenefits ?? '0'));
      const recruiting = dec(hiring.recruitingCost);
      const productive = weekly * hiring.annualProductiveWeeks * (1 - hiring.nonBillablePct / 100);
      const nonBillable = weekly * hiring.annualProductiveWeeks * (hiring.nonBillablePct / 100);
      // Linear onboarding ramp from 25 % to 100 % productivity (same rule as the capacity engine) ⇒ 37.5 % loss during onboarding.
      const rampLoss = Math.min(productive, hiring.onboardingWeeks * weekly * (1 - hiring.nonBillablePct / 100) * 0.375);
      const firstYearHours = Math.max(0, productive - rampLoss);
      totalCost = employer.plus(recruiting).plus(fixedInvestment);
      effective = firstYearHours > 0 ? totalCost.div(firstYearHours) : ZERO;
      fixedExposure = employer.plus(recruiting).plus(fixedInvestment);
      deliveredHours = D.min(demand, new D(firstYearHours));
      if (demand.gt(firstYearHours)) reasons.push(`One hire delivers ${round(firstYearHours)} productive hours in year one; demand is ${input.demandHours} h`);
      const breakEven = bill.gt(0) && productive > 0 ? totalCost.div(bill.times(productive)).toNumber() * 100 : null;
      hiringDetail = { totalEmployerCost: money(employer), productiveHours: round(productive), nonBillableHours: round(nonBillable), rampUpLossHours: round(rampLoss),
        breakEvenUtilizationPct: breakEven === null ? null : round(breakEven), breakEvenHoursVsFreelance: freelance?.hourlyCost && dec(freelance.hourlyCost).gt(0) ? round(totalCost.div(dec(freelance.hourlyCost)).toNumber()) : null };
      notes.push(`Employer cost assumption ${hiring.employerCostPct} % on salary (configured; verify with payroll)`, `Year-one view including ${hiring.onboardingWeeks} onboarding weeks`);
      if (breakEven !== null && breakEven > 100) reasons.push('Break-even utilization above 100 %: the hire cannot pay for itself at this bill rate');
    } else {
      if (!o.hourlyCost) reasons.push('Hourly cost is required');
      const rate = dec(o.hourlyCost ?? '0');
      const overhead = new D(1).plus(new D(o.coordinationOverheadPct ?? 0).div(100));
      if (o.kind === 'HYBRID') {
        const share = new D(o.internalSharePct ?? 50).div(100);
        const internalRate = dec(input.options.find((x) => x.kind === 'INTERNAL')?.hourlyCost ?? '0');
        totalCost = demand.times(share).times(internalRate).plus(demand.times(new D(1).minus(share)).times(rate).times(overhead)).plus(fixedInvestment);
        notes.push(`${share.times(100).toString()} % delivered internally at the INTERNAL option's rate`);
      } else {
        const billed = D.max(demand, new D(o.minimumCommitmentHours ?? 0));
        if (billed.gt(demand)) notes.push(`Minimum purchase commitment of ${o.minimumCommitmentHours} h applies`);
        totalCost = billed.times(rate).times(overhead).plus(fixedInvestment);
      }
      effective = demand.gt(0) ? totalCost.div(demand) : ZERO;
      if (o.capacityHours !== null && o.capacityHours !== undefined && o.capacityHours < input.demandHours) reasons.push(`Available capacity ${o.capacityHours} h is below demand ${input.demandHours} h`);
      if (o.kind === 'INTERNAL') notes.push('Uses capacity that is already paid; opportunity cost = work this capacity could otherwise deliver');
      if (['FREELANCE', 'SUBCONTRACT', 'PARTNER', 'HYBRID'].includes(o.kind)) notes.push('OCTA remains contractually responsible to the client for externally delivered scope');
      if (o.kind === 'FREELANCE') notes.push('Check freelancer engagement for false self-employment (Scheinselbständigkeit) risk with HR/legal');
    }
    const qualityCost = totalCost.times(qc);
    const contribution = deliveredHours.times(bill).minus(totalCost).minus(qualityCost);
    return { kind: o.kind, label: o.label, feasible: reasons.length === 0, infeasibleReasons: reasons, effectiveHourlyCost: money(effective), totalCost: money(totalCost),
      contribution: money(contribution), marginPct: ((r) => (r === null ? null : round(r * 100)))(ratio(contribution, deliveredHours.times(bill))),
      fixedCostExposure: money(fixedExposure), riskAdjustedCost: money(totalCost.plus(qualityCost)), leadTimeWeeks: lead, notes, ...(hiringDetail ? { hiring: hiringDetail } : {}) };
  });
  const feasible = results.filter((r) => r.feasible).sort((a, b) => dec(b.contribution).comparedTo(dec(a.contribution)) || dec(a.fixedCostExposure).comparedTo(dec(b.fixedCostExposure)));
  const best = feasible[0] ?? null;
  const source = best ? input.options.find((o) => o.label === best.label) : undefined;
  return {
    demandHours: input.demandHours, billRate: money(bill), options: results,
    recommendation: {
      label: best?.label ?? null,
      basis: best ? [`Highest contribution among feasible options: ${best.contribution} (${best.marginPct ?? '–'} %)`, `Fixed cost exposure ${best.fixedCostExposure}`, `Lead time ${best.leadTimeWeeks} weeks`]
        : ['No option is feasible under the given capacity and lead-time constraints'],
      assumptions: [`Demand ${input.demandHours} h at bill rate ${money(bill)}`, 'Quality-control effort is added as a percentage of option cost', 'Ties are broken by lower fixed cost exposure'],
      risks: [...(source?.riskScore ? [`Delivery risk assessment ${source.riskScore}/5`] : []), ...(source?.dependencyRisk ? [`Dependency risk ${source.dependencyRisk}/5`] : []), ...(best?.notes ?? [])],
      alternatives: feasible.slice(1).map((r) => `${r.label}: contribution ${r.contribution}`),
    },
  };
}
