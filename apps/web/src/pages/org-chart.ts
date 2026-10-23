export interface OrgEmployee {
  id: string;
  firstName: string;
  lastName: string;
  managerId: string | null;
  position?: OrgPosition | null;
  department?: { id: string; name: string } | null;
}

export interface OrgPosition {
  id: string;
  code?: string;
  name: string;
  level?: string | null;
  status?: PositionStatus;
  department?: { id: string; name: string } | null;
}

export type PositionStatus = 'OPEN' | 'BUDGETED' | 'FILLED';
export interface OrgChartSnapshot {
  schemaVersion: 1;
  departments: OrgDepartment[];
  employees: OrgEmployee[];
  positions: OrgPosition[];
}
export interface OrgChartVersion {
  id: string;
  version: number;
  title: string;
  note: string | null;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
  snapshot: OrgChartSnapshot;
}

export function positionStatus(position: OrgPosition, employees: OrgEmployee[]): PositionStatus {
  return employees.some((employee) => employee.position?.id === position.id) ? 'FILLED' : position.status ?? 'OPEN';
}

export interface OrgChartChange {
  entity: 'departments' | 'positions' | 'employees';
  kind: 'added' | 'removed' | 'changed';
  id: string;
  label: string;
  fields: { field: string; before: string | null; after: string | null }[];
}

export function compareOrgCharts(before: OrgChartSnapshot, after: OrgChartSnapshot): OrgChartChange[] {
  const normalize = (snapshot: OrgChartSnapshot) => ({
    departments: new Map(snapshot.departments.map((item) => [item.id, {
      name: item.name, code: item.code ?? null, parent: item.parentId ?? null, manager: item.managerId ?? null,
    }])),
    positions: new Map(snapshot.positions.map((item) => [item.id, {
      name: item.name, code: item.code ?? null, level: item.level ?? null,
      department: item.department?.id ?? null, status: positionStatus(item, snapshot.employees),
    }])),
    employees: new Map(snapshot.employees.map((item) => [item.id, {
      name: `${item.firstName} ${item.lastName}`, department: item.department?.id ?? null,
      position: item.position?.id ?? null, manager: item.managerId,
    }])),
  });
  const previous = normalize(before);
  const current = normalize(after);
  const label = (snapshot: OrgChartSnapshot, field: string, value: string | null) => {
    if (!value) return value;
    if (field === 'department' || field === 'parent') return snapshot.departments.find((row) => row.id === value)?.name ?? value;
    if (field === 'position') return snapshot.positions.find((row) => row.id === value)?.name ?? value;
    if (field === 'manager') {
      const employee = snapshot.employees.find((row) => row.id === value);
      return employee ? `${employee.firstName} ${employee.lastName}` : value;
    }
    return value;
  };
  const changes: OrgChartChange[] = [];
  for (const entity of ['departments', 'positions', 'employees'] as const) {
    const oldRows: Map<string, Record<string, string | null>> = previous[entity];
    const newRows: Map<string, Record<string, string | null>> = current[entity];
    for (const id of new Set([...oldRows.keys(), ...newRows.keys()])) {
      const oldRow = oldRows.get(id);
      const newRow = newRows.get(id);
      const fields = Object.keys(newRow ?? oldRow ?? {}).filter((field) => oldRow?.[field] !== newRow?.[field])
        .map((field) => ({ field, before: label(before, field, oldRow?.[field] ?? null), after: label(after, field, newRow?.[field] ?? null) }));
      if (fields.length) changes.push({ entity, id, label: newRow?.name ?? oldRow?.name ?? id,
        kind: !oldRow ? 'added' : !newRow ? 'removed' : 'changed', fields });
    }
  }
  return changes;
}

export interface PositionNode {
  id: string;
  position: OrgPosition | null;
  employee: OrgEmployee | null;
  children: PositionNode[];
}

export interface OrgDepartment {
  id: string;
  code?: string;
  name: string;
  parentId?: string | null;
  managerId?: string | null;
}

export interface EmployeeNode extends OrgEmployee {
  children: EmployeeNode[];
}

export interface DepartmentNode extends OrgDepartment {
  children: DepartmentNode[];
  positions: PositionNode[];
  employeeCount: number;
}

// Missing parents and invalid cycles become roots so every record remains visible.
function buildTree<T extends { id: string; children: T[] }>(
  nodes: T[], parentId: (node: T) => string | null | undefined, compare: (a: T, b: T) => number,
): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: T[] = [];
  for (const node of nodes) {
    const parent = byId.get(parentId(node) ?? '');
    const seen = new Set([node.id]);
    let ancestor = parent;
    while (ancestor && !seen.has(ancestor.id)) {
      seen.add(ancestor.id);
      ancestor = byId.get(parentId(ancestor) ?? '');
    }
    if (parent && !ancestor) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: T[]) => {
    items.sort(compare);
    items.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

export function buildEmployeeTree(employees: OrgEmployee[]): EmployeeNode[] {
  return buildTree(employees.map((employee) => ({ ...employee, children: [] })),
    (node) => node.managerId,
    (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

export function buildPositionTree(positions: OrgPosition[], employees: OrgEmployee[]): PositionNode[] {
  const byId = new Map(positions.map((position) => [position.id, position]));
  const occupied = new Set<string>();
  const nodes: PositionNode[] = employees.map((employee) => {
    const position = employee.position;
    if (position) occupied.add(position.id);
    return {
      id: `employee:${employee.id}`,
      position: position ? { ...byId.get(position.id), ...position } : null,
      employee,
      children: [],
    };
  });
  for (const position of positions) {
    if (!occupied.has(position.id)) {
      nodes.push({ id: `position:${position.id}`, position, employee: null, children: [] });
    }
  }
  // Each occupant gets a node: a shared job title can report to different managers.
  return buildTree(nodes,
    (node) => node.employee?.managerId ? `employee:${node.employee.managerId}` : null,
    (a, b) => (a.position?.name ?? '').localeCompare(b.position?.name ?? '')
      || (a.employee?.lastName ?? '').localeCompare(b.employee?.lastName ?? '')
      || (a.employee?.firstName ?? '').localeCompare(b.employee?.firstName ?? ''));
}

export function buildDepartmentTree(departments: OrgDepartment[], employees: OrgEmployee[], positions: OrgPosition[] = []) {
  const byId = new Map(departments.map((department) => [department.id, department]));
  const positionsById = new Map(positions.map((position) => [position.id, position]));
  const occupied = new Set(employees.flatMap((employee) => employee.position ? [employee.position.id] : []));
  const members = new Map<string, OrgEmployee[]>();
  const vacancies = new Map<string, OrgPosition[]>();
  const unassigned: OrgEmployee[] = [];
  const unassignedPositions: OrgPosition[] = [];
  for (const employee of employees) {
    const position = employee.position ? { ...positionsById.get(employee.position.id), ...employee.position } : null;
    const member = { ...employee, position };
    const department = employee.department ?? position?.department;
    if (!department) {
      unassigned.push(member);
      continue;
    }
    // Employees assigned to an inactive department still need a place in the chart.
    if (!byId.has(department.id)) byId.set(department.id, department);
    const group = members.get(department.id) ?? [];
    group.push(member);
    members.set(department.id, group);
  }
  for (const position of positions) {
    // Determine vacancies across the company so shared positions aren't duplicated.
    if (occupied.has(position.id)) continue;
    const department = position.department;
    if (!department) {
      unassignedPositions.push(position);
      continue;
    }
    if (!byId.has(department.id)) byId.set(department.id, department);
    const group = vacancies.get(department.id) ?? [];
    group.push(position);
    vacancies.set(department.id, group);
  }
  const nodes: DepartmentNode[] = [...byId.values()].map((department) => ({
    ...department,
    children: [],
    positions: buildPositionTree(vacancies.get(department.id) ?? [], members.get(department.id) ?? []),
    employeeCount: members.get(department.id)?.length ?? 0,
  }));
  return {
    roots: buildTree(nodes, (node) => node.parentId, (a, b) => a.name.localeCompare(b.name)),
    unassigned: buildPositionTree(unassignedPositions, unassigned),
  };
}
