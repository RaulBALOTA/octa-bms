import { describe, expect, it } from 'vitest';
import { buildDepartmentTree, buildEmployeeTree, buildPositionTree, compareOrgCharts, OrgChartSnapshot, OrgEmployee, positionStatus } from './org-chart';

function employee(id: string, departmentId: string | null, managerId: string | null = null): OrgEmployee {
  return { id, firstName: id, lastName: id, managerId,
    department: departmentId ? { id: departmentId, name: 'Same name' } : null };
}

describe('org chart hierarchy', () => {
  it('groups by department ID, preserves empty departments, and keeps cross-department reports visible', () => {
    const tree = buildDepartmentTree([
      { id: 'parent', name: 'Same name' },
      { id: 'child', name: 'Same name', parentId: 'parent' },
      { id: 'empty', name: 'Empty', parentId: 'parent' },
    ], [employee('manager', 'parent'), employee('report', 'child', 'manager'), employee('unassigned', null)]);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].positions.map((node) => node.employee?.id)).toEqual(['manager']);
    expect(tree.roots[0].children.find((node) => node.id === 'child')?.positions.map((node) => node.employee?.id)).toEqual(['report']);
    expect(tree.roots[0].children.find((node) => node.id === 'empty')?.employeeCount).toBe(0);
    expect(tree.unassigned.map((node) => node.employee?.id)).toEqual(['unassigned']);
  });

  it('keeps departments with missing parents and employees assigned outside the active department list', () => {
    const tree = buildDepartmentTree([{ id: 'orphan', name: 'Orphan', parentId: 'missing' }], [employee('active', 'inactive')]);
    expect(tree.roots.map((node) => node.id).sort()).toEqual(['inactive', 'orphan']);
    expect(tree.roots.find((node) => node.id === 'inactive')?.positions[0].employee?.id).toBe('active');
  });

  it('keeps employee and department cycles visible without recursive loops', () => {
    const roots = buildEmployeeTree([employee('a', null, 'b'), employee('b', null, 'a'), employee('self', null, 'self')]);
    expect(roots.map((node) => node.id)).toEqual(['a', 'b', 'self']);
    const departments = buildDepartmentTree([
      { id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' },
    ], []);
    expect(departments.roots.map((node) => node.id)).toEqual(['a', 'b']);
  });

  it('uses separate occupied position nodes when a shared title reports to different managers', () => {
    const director = { id: 'director', name: 'Director' };
    const designer = { id: 'designer', name: 'Designer' };
    const roots = buildPositionTree([director, designer], [
      { ...employee('manager-a', 'a'), position: director },
      { ...employee('manager-b', 'b'), position: director },
      { ...employee('report-a', 'a', 'manager-a'), position: designer },
      { ...employee('report-b', 'b', 'manager-b'), position: designer },
    ]);
    expect(roots).toHaveLength(2);
    expect(roots[0].children[0].employee?.id).toBe('report-a');
    expect(roots[1].children[0].employee?.id).toBe('report-b');
    expect(roots.every((root) => root.position?.id === 'director')).toBe(true);
  });

  it('shows unfilled positions, inactive assigned positions, and employees without a position', () => {
    const roots = buildPositionTree([{ id: 'empty', name: 'Vacant role' }], [
      { ...employee('manager', null), position: { id: 'inactive', name: 'Old role' } },
      employee('report', null, 'manager'),
    ]);
    const manager = roots.find((root) => root.employee?.id === 'manager');
    expect(manager?.position?.id).toBe('inactive');
    expect(manager?.children[0].position).toBeNull();
    expect(manager?.children[0].employee?.id).toBe('report');
    expect(roots.find((root) => root.position?.id === 'empty')?.employee).toBeNull();
  });

  it('places occupied and unfilled positions in departments without duplicating shared roles as vacancies', () => {
    const shared = { id: 'shared', name: 'Shared role', department: { id: 'a', name: 'A' } };
    const tree = buildDepartmentTree([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], [
      { ...employee('manager', 'a'), position: shared },
      { ...employee('report', 'a', 'manager'), position: shared },
      { ...employee('other', 'b', 'manager'), position: shared },
    ], [shared, { id: 'vacant', name: 'Vacant role', department: { id: 'b', name: 'B' } }, { id: 'global', name: 'Global role' }]);
    const a = tree.roots.find((node) => node.id === 'a')!;
    const b = tree.roots.find((node) => node.id === 'b')!;
    expect(a.positions).toHaveLength(1);
    expect(a.positions[0].children[0].employee?.id).toBe('report');
    expect(b.positions).toHaveLength(2);
    expect(b.positions.find((node) => node.position?.id === 'shared')?.employee?.id).toBe('other');
    expect(b.positions.find((node) => node.position?.id === 'vacant')?.employee).toBeNull();
    expect(tree.unassigned[0].position?.id).toBe('global');
  });

  it('uses the position department when the employee has no department and keeps vacancy-only departments visible', () => {
    const position = { id: 'role', name: 'Role', department: { id: 'a', name: 'A' } };
    const tree = buildDepartmentTree([], [{ ...employee('member', null), position: { id: 'role', name: 'Role' } }], [
      position, { id: 'vacant', name: 'Vacant role', department: { id: 'b', name: 'B' } },
    ]);
    expect(tree.unassigned).toHaveLength(0);
    expect(tree.roots.find((node) => node.id === 'a')?.positions[0].employee?.id).toBe('member');
    expect(tree.roots.find((node) => node.id === 'a')?.employeeCount).toBe(1);
    expect(tree.roots.find((node) => node.id === 'b')?.positions[0].position?.id).toBe('vacant');
  });
});

describe('org chart snapshot comparisons', () => {
  const before: OrgChartSnapshot = {
    schemaVersion: 1,
    departments: [{ id: 'a', name: 'Administration' }, { id: 'b', name: 'Engineering' }],
    employees: [{ ...employee('manager', 'a'), position: { id: 'director', name: 'Director' } }],
    positions: [{ id: 'director', name: 'Director', status: 'OPEN' }, { id: 'vacant', name: 'Developer', status: 'OPEN' }],
  };
  it('detects status and reporting changes, with added and removed positions', () => {
    const after = structuredClone(before);
    after.positions[1].status = 'BUDGETED';
    after.positions.push({ id: 'new', name: 'New role', status: 'OPEN' });
    after.positions = after.positions.filter((position) => position.id !== 'director');
    after.departments[1].parentId = 'a';
    after.employees[0].department = { id: 'b', name: 'Engineering' };
    const changes = compareOrgCharts(before, after);
    expect(changes.find((change) => change.id === 'vacant')?.fields).toEqual([{ field: 'status', before: 'OPEN', after: 'BUDGETED' }]);
    expect(changes.find((change) => change.id === 'new')?.kind).toBe('added');
    expect(changes.find((change) => change.id === 'director')?.kind).toBe('removed');
    expect(changes.find((change) => change.id === 'b')?.fields).toEqual([{ field: 'parent', before: null, after: 'Administration' }]);
    expect(changes.find((change) => change.id === 'manager')?.fields).toContainEqual({ field: 'department', before: 'Administration', after: 'Engineering' });
  });
  it('derives Filled from occupants and ignores array order', () => {
    expect(positionStatus(before.positions[0], before.employees)).toBe('FILLED');
    const reordered = structuredClone(before);
    reordered.departments.reverse(); reordered.positions.reverse();
    expect(compareOrgCharts(before, reordered)).toEqual([]);
    const filled = structuredClone(before);
    filled.employees.push({ ...employee('developer', 'b'), position: { id: 'vacant', name: 'Developer' } });
    expect(compareOrgCharts(before, filled).find((change) => change.id === 'vacant')?.fields)
      .toEqual([{ field: 'status', before: 'OPEN', after: 'FILLED' }]);
  });
});
