import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from 'react-router-dom';
import '@fontsource-variable/inter';
import './i18n';
import './index.css';
import { Layout } from './app/Layout';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { ContractsPage } from './pages/ContractsPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { AdminPage } from './pages/AdminPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { AssetsPage } from './pages/AssetsPage';
import { BiPage } from './pages/BiPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { CashFlowPage } from './pages/CashFlowPage';
import { DunningPage } from './pages/DunningPage';
import { CommunicationPage } from './pages/CommunicationPage';
import {
  ExpiryPage,
  GuaranteesPage,
  InsurancePage,
} from './pages/ContractsExtrasPages';
import { DatevPage } from './pages/DatevPage';
import { OpenItemsPage } from './pages/OpenItemsPage';
import { OrgChartPage } from './pages/OrgChartPage';
import { StaffingBudgetPage } from './pages/StaffingBudgetPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { RecruitmentPage } from './pages/RecruitmentPage';
import { CorporatePage } from './pages/CorporatePage';
import { CompanyCalendarPage } from './pages/CompanyCalendarPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { GroupComparePage } from './pages/GroupComparePage';
import { GroupPage } from './pages/GroupPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { LeavePage } from './pages/LeavePage';
import { LegalPage } from './pages/LegalPage';
import { ProcurementPage } from './pages/ProcurementPage';
import { WorkflowPage } from './pages/WorkflowPage';
import { LoginPage } from './pages/LoginPage';
import { OidcCallbackPage } from './pages/OidcCallbackPage';
import { PartnersPage } from './pages/PartnersPage';
import { PipelinePage } from './pages/PipelinePage';
import { WinLossPage } from './pages/WinLossPage';
import { useAuthStore } from './stores/auth';
import { DataManagementPage } from './pages/DataManagementPage';
import { MyTimePage } from './features/working-time/MyTimePage';
import { TeamTimePage } from './features/working-time/TeamTimePage';
import { PlanningPage } from './features/working-time/PlanningPage';
import { SchedulesPage } from './features/working-time/SchedulesPage';
import { PmoIntegrationPage } from './features/working-time/PmoIntegrationPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const me = useAuthStore((s) => s.me);
  const loadMe = useAuthStore((s) => s.loadMe);

  useEffect(() => {
    if (accessToken && !me) void loadMe();
  }, [accessToken, me, loadMe]);

  if (!accessToken) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/oidc', element: <OidcCallbackPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/approvals', element: <ApprovalsPage /> },
          { path: '/crm/partners', element: <PartnersPage /> },
          { path: '/crm/partners/:id', element: <PartnersPage /> },
          { path: '/sales/pipeline', element: <PipelinePage /> },
          { path: '/sales/win-loss', element: <WinLossPage /> },
          { path: '/hr/employees', element: <EmployeesPage /> },
          { path: '/hr/employees/:id', element: <EmployeesPage /> },
          { path: '/hr/leave', element: <LeavePage /> },
          { path: '/hr/recruitment', element: <RecruitmentPage /> },
          { path: '/hr/org-chart', element: <OrgChartPage /> },
          { path: '/hr/staffing-budgets', element: <StaffingBudgetPage /> },
          { path: '/time', element: <MyTimePage /> },
          { path: '/time/team', element: <TeamTimePage /> },
          { path: '/time/planning', element: <PlanningPage /> },
          { path: '/time/schedules', element: <SchedulesPage /> },
          { path: '/time/pmo', element: <PmoIntegrationPage /> },
          { path: '/assets', element: <AssetsPage /> },
          { path: '/assets/:id', element: <AssetsPage /> },
          { path: '/corporate', element: <CorporatePage /> },
          { path: '/company-calendar', element: <CompanyCalendarPage /> },
          { path: '/group', element: <GroupPage /> },
          { path: '/group/compare', element: <GroupComparePage /> },
          { path: '/legal', element: <LegalPage /> },
          { path: '/legal/cases', element: <LegalPage /> },
          { path: '/procurement', element: <ProcurementPage /> },
          { path: '/knowledge', element: <KnowledgePage /> },
          { path: '/documents', element: <DocumentsPage /> },
          { path: '/communication', element: <CommunicationPage /> },
          { path: '/workflow', element: <WorkflowPage /> },
          { path: '/bi', element: <BiPage /> },
          { path: '/admin', element: <AdminPage /> },
          { path: '/admin/data', element: <DataManagementPage /> },
          { path: '/contracts', element: <ContractsPage /> },
          { path: '/contracts/guarantees', element: <GuaranteesPage /> },
          { path: '/contracts/insurance', element: <InsurancePage /> },
          { path: '/contracts/expiry', element: <ExpiryPage /> },
          { path: '/finance/invoices', element: <InvoicesPage /> },
          { path: '/finance/invoices/:id', element: <InvoicesPage /> },
          { path: '/finance/payments', element: <PaymentsPage /> },
          { path: '/finance/open-items', element: <OpenItemsPage /> },
          { path: '/finance/cashflow', element: <CashFlowPage /> },
          { path: '/finance/budgets', element: <BudgetsPage /> },
          { path: '/finance/dunning', element: <DunningPage /> },
          { path: '/finance/datev', element: <DatevPage /> },
          { path: '*', element: <ComingSoonPage /> },
        ],
      },
    ],
  },
]);

import { ToastProvider } from './components/ui';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
