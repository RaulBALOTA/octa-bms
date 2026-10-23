import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { BriefcaseBusiness, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { HrNav } from '../components/HrNav';
import { Avatar, Button, SelectInput, Skeleton, useToast } from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';
import { OrgChartVersions } from './OrgChartVersions';
import {
  buildDepartmentTree, buildEmployeeTree,
  DepartmentNode, EmployeeNode, OrgChartSnapshot, OrgChartVersion, OrgDepartment, OrgEmployee, OrgPosition, PositionNode, PositionStatus,
} from './org-chart';

const ChartContext = createContext<{ readOnly: boolean; pending: boolean; updateStatus?: (id: string, status: PositionStatus) => void }>({ readOnly: true, pending: false });

function NodeCard({ node }: { node: EmployeeNode }) {
  const { readOnly } = useContext(ChartContext);
  return (
    <li>
      <div className="card">
        <div className="inline-flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 text-left shadow-sm">
          <Avatar name={`${node.firstName} ${node.lastName}`} size={32} />
          {!readOnly && <RecordActions resource="employees" id={node.id} label={`${node.firstName} ${node.lastName}`} />}
          <div>
            <div className="whitespace-nowrap text-sm font-semibold">
              {node.firstName} {node.lastName}
            </div>
            <div className="whitespace-nowrap text-[11px] text-muted-foreground">
              {node.position?.name ?? '—'}
              {node.department ? ` · ${node.department.name}` : ''}
            </div>
          </div>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <NodeCard key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DepartmentCard({ node }: { node: DepartmentNode }) {
  const { t } = useTranslation();
  const { readOnly } = useContext(ChartContext);
  const manager = node.managerId ? node.positions.find((position) => position.employee?.id === node.managerId) : undefined;
  const hasBranches = node.children.length > 0 || node.positions.some((position) => position !== manager);
  const branches = <>
    {node.children.map((child) => <DepartmentCard key={child.id} node={child} />)}
    {node.positions.filter((position) => position !== manager).map((position) => <PositionCard key={position.id} node={position} />)}
  </>;
  return (
    <li data-department-id={node.id}>
      <div className="card">
        <div className="inline-flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-left shadow-sm">
          <Building2 size={24} className="shrink-0 text-primary" aria-hidden="true" />
          <div>
            <div className="whitespace-nowrap text-sm font-semibold">{node.name}</div>
            <div className="whitespace-nowrap text-[11px] text-muted-foreground">
              {node.code ? `${node.code} · ` : ''}{t('hr.orgEmployeeCount', { count: node.employeeCount })}
            </div>
          </div>
          {!readOnly && <RecordActions resource="departments" id={node.id} label={node.name} />}
        </div>
      </div>
      {(node.children.length > 0 || node.positions.length > 0) && (
        <ul>
          {manager ? <PositionCard node={manager}>{hasBranches ? branches : null}</PositionCard> : branches}
        </ul>
      )}
    </li>
  );
}

function PositionCard({ node, children }: { node: PositionNode; children?: ReactNode }) {
  const { t } = useTranslation();
  const { readOnly, pending, updateStatus } = useContext(ChartContext);
  const employee = node.employee;
  const position = node.position;
  const department = employee?.department ?? position?.department;
  const status = employee ? 'FILLED' : position?.status ?? 'OPEN';
  return (
    <li data-position-node={node.id}>
      <div className="card">
        <div className="inline-flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-left shadow-sm">
          <BriefcaseBusiness size={24} className="shrink-0 text-primary" aria-hidden="true" />
          <div>
            <div className="whitespace-nowrap text-sm font-semibold">{position?.name ?? t('hr.noPosition')}</div>
            {position && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              status === 'FILLED' ? 'bg-green-100 text-green-800' : status === 'BUDGETED' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
            }`}>{t(`hr.positionStatus.${status}`)}</span>}
            {(position?.code || position?.level) && <div className="whitespace-nowrap text-[11px] text-muted-foreground">
              {[position.code, position.level].filter(Boolean).join(' · ')}
            </div>}
            {department && <div className="whitespace-nowrap text-[11px] text-muted-foreground">{department.name}</div>}
            {employee ? <div className="mt-2 flex items-center gap-2 text-xs">
              <Avatar name={`${employee.firstName} ${employee.lastName}`} size={24} />
              <span className="whitespace-nowrap">{employee.firstName} {employee.lastName}</span>
              {!readOnly && <RecordActions resource="employees" id={employee.id} label={`${employee.firstName} ${employee.lastName}`} />}
            </div> : <div className="mt-2 text-xs text-muted-foreground">{t('hr.unfilledPosition')}</div>}
            {position && !employee && !readOnly && updateStatus && <SelectInput className="mt-2 text-xs"
              aria-label={t('hr.positionStatusNamed', { name: position.name })} value={status} disabled={pending}
              onChange={(event) => updateStatus(position.id, event.target.value as PositionStatus)}>
              <option value="OPEN">{t('hr.positionStatus.OPEN')}</option>
              <option value="BUDGETED">{t('hr.positionStatus.BUDGETED')}</option>
            </SelectInput>}
          </div>
          {position && !readOnly && <RecordActions resource="positions" id={position.id} label={position.name} />}
        </div>
      </div>
      {(node.children.length > 0 || children) && <ul>
        {node.children.map((child) => <PositionCard key={child.id} node={child} />)}
        {children}
      </ul>}
    </li>
  );
}

export function OrgChartPage() {
  const { t } = useTranslation();
  const companyId = useAuthStore((state) => state.companyId);
  const me = useAuthStore((state) => state.me);
  const client = useQueryClient();
  const toast = useToast();
  const canEdit = hasPermission(me, 'hr.employees.read') && hasPermission(me, 'hr.employees.update');
  const [view, setView] = useState<'organization' | 'employees'>('organization');
  const [selection, setSelection] = useState({ companyId, id: '' });
  const selectedId = selection.companyId === companyId ? selection.id : '';

  const { data: liveEmployees, isLoading, error: employeesError } = useQuery({
    queryKey: ['org-chart', companyId],
    queryFn: () => api.get<OrgEmployee[]>('/hr/employees/org-chart'),
  });
  const { data: liveDepartments, isLoading: departmentsLoading, error: departmentsError } = useQuery({
    queryKey: ['departments', companyId],
    queryFn: () => api.get<OrgDepartment[]>('/master/departments'),
  });
  const { data: livePositions, isLoading: positionsLoading, error: positionsError } = useQuery({
    queryKey: ['org-chart-positions', companyId],
    queryFn: () => api.get<OrgPosition[]>('/hr/employees/org-chart/positions'),
    enabled: view === 'organization' || !!selectedId,
  });
  const historical = useQuery({ queryKey: ['org-chart-version', companyId, selectedId], enabled: !!selectedId,
    queryFn: () => api.get<OrgChartVersion>(`/hr/org-chart/versions/${encodeURIComponent(selectedId)}`) });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PositionStatus; companyId: string | null }) => api.patch(`/hr/org-chart/positions/${encodeURIComponent(id)}/status`, { status }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['org-chart-positions', variables.companyId] }),
        client.invalidateQueries({ queryKey: ['org-chart-versions', variables.companyId] }),
        client.invalidateQueries({ queryKey: ['recruitment', variables.companyId, 'open-positions'] }),
      ]);
      toast(t('common.saved'));
    },
  });
  const live = useMemo<OrgChartSnapshot>(() => ({ schemaVersion: 1, departments: liveDepartments ?? [],
    employees: liveEmployees ?? [], positions: livePositions ?? [] }), [liveDepartments, liveEmployees, livePositions]);
  const chart = selectedId ? historical.data?.snapshot : live;
  const employees = chart?.employees;
  const departments = chart?.departments;
  const positions = chart?.positions;

  const roots = useMemo(() => buildEmployeeTree(employees ?? []), [employees]);
  const departmentTree = useMemo(() => buildDepartmentTree(departments ?? [], employees ?? [], positions ?? []), [departments, employees, positions]);
  const error = selectedId ? historical.error : employeesError ?? (view === 'organization' ? departmentsError ?? positionsError : null);
  const loading = selectedId ? historical.isLoading : isLoading || (view === 'organization' && (departmentsLoading || positionsLoading));
  const liveReady = !!liveEmployees && !!liveDepartments && !!livePositions && !employeesError && !departmentsError && !positionsError;
  const empty = view === 'organization'
    ? !departmentTree.roots.length && !departmentTree.unassigned.length
    : !roots.length;

  return (
    <>
      <HrNav />
      <h1 className="mb-5 text-lg font-bold">{t('hr.orgChart')}</h1>
      <OrgChartVersions companyId={companyId} selectedId={selectedId} onSelect={(id) => setSelection({ companyId, id })}
        canEdit={canEdit} live={live} ready={liveReady} />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('hr.orgChartView')}>
        <Button variant={view === 'organization' ? 'primary' : 'secondary'} aria-pressed={view === 'organization'} onClick={() => setView('organization')}>
          {t('hr.departmentsAndPositions')}
        </Button>
        <Button variant={view === 'employees' ? 'primary' : 'secondary'} aria-pressed={view === 'employees'} onClick={() => setView('employees')}>
          {t('hr.employeeReporting')}
        </Button>
      </div>
      {view === 'organization' && <p className="mb-4 text-xs text-muted-foreground">{t('hr.positionChartHint')}</p>}
      {view === 'organization' && <p className="mb-4 text-xs text-muted-foreground">{t('hr.positionStatusHint')}</p>}
      {!selectedId && statusMutation.error && statusMutation.variables?.companyId === companyId && <p role="alert" className="mb-3 text-sm text-destructive">{statusMutation.error.message}</p>}

      {loading ? (
        <Skeleton className="h-72" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{error.message}</p>
      ) : empty ? (
        <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
      ) : (
        <div className="overflow-x-auto pb-6">
          {/* classic CSS org-chart tree: connectors drawn with borders */}
          <style>{`
            .org ul { display:flex; justify-content:center; padding-top:24px; position:relative; }
            .org li { list-style:none; position:relative; padding:24px 10px 0; text-align:center; }
            .org li::before, .org li::after {
              content:''; position:absolute; top:0; right:50%;
              border-top:1.5px solid hsl(var(--border)); width:50%; height:24px;
            }
            .org li::after { right:auto; left:50%; border-left:1.5px solid hsl(var(--border)); }
            .org li:only-child::after, .org li:only-child::before { display:none; }
            .org li:only-child { padding-top:0; }
            .org li:first-child::before, .org li:last-child::after { border:0 none; }
            .org li:last-child::before {
              border-right:1.5px solid hsl(var(--border)); border-radius:0 6px 0 0;
            }
            .org li:first-child::after { border-radius:6px 0 0 0; }
            .org ul ul::before {
              content:''; position:absolute; top:0; left:50%;
              border-left:1.5px solid hsl(var(--border)); width:0; height:24px;
            }
            .org > ul { padding-top:0; }
            .org > ul > li { padding-top:0; }
            .org > ul > li::before, .org > ul > li::after { display:none; }
          `}</style>
          <ChartContext.Provider value={{ readOnly: !!selectedId, pending: statusMutation.isPending,
            updateStatus: canEdit && !selectedId ? (id, status) => statusMutation.mutate({ id, status, companyId }) : undefined }}>
          <div className="org min-w-max">
            <ul>
              {view === 'employees' ? roots.map((root) => <NodeCard key={root.id} node={root} />)
                : <>
                {departmentTree.roots.map((root) => <DepartmentCard key={root.id} node={root} />)}
                {departmentTree.unassigned.length > 0 && <li>
                  <div className="card">
                    <div className="inline-block rounded-xl border border-border bg-muted px-4 py-3 text-sm font-semibold">{t('hr.noDepartment')}</div>
                  </div>
                  <ul>{departmentTree.unassigned.map((position) => <PositionCard key={position.id} node={position} />)}</ul>
                </li>}
              </>}
            </ul>
          </div>
          </ChartContext.Provider>
        </div>
      )}
    </>
  );
}
