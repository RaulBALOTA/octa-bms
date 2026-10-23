import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../../core/auth/decorators';
import { EngineAnalyticsController, EngineAssignmentsController, EngineIntelligenceController, EngineResourcesController, EngineScenariosController } from './engine.controllers';
import { validateOperations } from './dto';
import { csvCell } from './analytics.service';

const perms = (cls: { prototype: object }, method: string) => Reflect.getMetadata(PERMISSIONS_KEY, (cls.prototype as Record<string, unknown>)[method] as object) as string[];

describe('business engine access control', () => {
  it.each([
    [EngineAnalyticsController, 'overview', ['engine.economics.read']],
    [EngineAnalyticsController, 'capacity', ['engine.resources.read']],
    [EngineAnalyticsController, 'report', ['engine.economics.export']],
    [EngineAssignmentsController, 'economics', ['engine.portfolio.read', 'engine.economics.read']],
    [EngineResourcesController, 'addRate', ['engine.resources.update', 'engine.economics.update']],
    [EngineScenariosController, 'run', ['engine.scenarios.read', 'engine.economics.read']],
    [EngineScenariosController, 'optimize', ['engine.optimization.create', 'engine.economics.read']],
    [EngineIntelligenceController, 'analyze', ['engine.intelligence.create', 'engine.economics.read']],
    [EngineIntelligenceController, 'decide', ['engine.services.approve']],
  ] as const)('%o.%s requires %o', (cls, method, expected) => { expect(perms(cls, method)).toEqual(expected); });
});

describe('scenario operation validation', () => {
  it('accepts valid operations and builds simulated new-service assignments', () => {
    const ops = validateOperations([{ type: 'WIN', opportunityId: 'o' }, { type: 'PRICE', pct: 5 }, { type: 'NEW_SERVICE', name: 'Energy audit', start: '2027-01-04', end: '2027-03-26', fixedFee: '30000.00', hours: 200, probabilityPct: 50 }]);
    expect(ops[2]).toMatchObject({ type: 'NEW_SERVICE', assignment: { commitment: 'PIPELINE', probability: 0.5, fixedFee: '30000.00' } });
  });
  it.each([
    [{ type: 'LOSE' }, /assignmentIds or opportunityId/], [{ type: 'DROP_TABLE' }, /unsupported type/], [{ type: 'PRICE', pct: 5, extra: 1 }, /unknown property/],
    [{ type: 'PRICE', pct: -150 }, /pct/], [{ type: 'HIRE', name: 'x', skillIds: [], weeklyHours: 40, start: '2027-01-01', monthlyFixedCost: '-5', costRate: '50' }, /monthlyFixedCost/],
    [{ type: 'NEW_SERVICE', name: 'x', start: '2027-02-01', end: '2027-01-01', fixedFee: '1', hours: 1 }, /end must not precede/],
  ])('rejects %o', (op, message) => { expect(() => validateOperations([op])).toThrow(BadRequestException); expect(() => validateOperations([op])).toThrow(message); });
});

describe('CSV export safety', () => {
  it('neutralises spreadsheet formulas but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1200.50')).toBe('-1200.50');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell(null)).toBe('');
  });
});
