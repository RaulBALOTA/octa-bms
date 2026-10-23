import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
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
import { AcceptInvitePage, ForgotPasswordPage, LoginPage, MfaPage, RecoveryPage, ResetPasswordPage, SetupMfaPage } from './pages/auth/AuthPages';
import { StepUpDialog } from './pages/auth/components';
import { SecurityPage } from './pages/SecurityPage';
import { AdminSecurityPage } from './pages/AdminSecurityPage';
import { PartnersPage } from './pages/PartnersPage';
import { PipelinePage } from './pages/PipelinePage';
import { WinLossPage } from './pages/WinLossPage';
import { useAuthStore } from './stores/auth';
import { DataManagementPage } from './pages/DataManagementPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

/**
 * Route guard driven by the server-side state machine. Business routes render only in
 * AUTHENTICATED; MFA-pending and enrollment-required users are sent to their step.
 */
function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const me = useAuthStore((s) => s.me);
  const refreshState = useAuthStore((s) => s.refreshState);
  const loadMe = useAuthStore((s) => s.loadMe);
  const location = useLocation();
  const next = encodeURIComponent(`${location.pathname}${location.search}`);

  useEffect(() => {
    if (status === 'UNKNOWN') void refreshState();
  }, [status, refreshState]);
  useEffect(() => {
    if (status === 'AUTHENTICATED' && !me) void loadMe();
  }, [status, me, loadMe]);

  if (status === 'UNKNOWN') return <div className="p-8 text-center text-sm text-muted-foreground" role="status">…</div>;
  if (status === 'MFA_PENDING') return <Navigate to={`/auth/mfa?next=${next}`} replace />;
  if (status === 'MFA_ENROLLMENT_REQUIRED') return <Navigate to={`/auth/setup-mfa?next=${next}`} replace />;
  if (status !== 'AUTHENTICATED') return <Navigate to={`/login?next=${next}`} replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/auth/mfa', element: <MfaPage /> },
  { path: '/auth/recovery', element: <RecoveryPage /> },
  { path: '/auth/setup-mfa', element: <SetupMfaPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/invite', element: <AcceptInvitePage /> },
  { path: '/oidc', element: <Navigate to="/" replace /> },
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
          { path: '/admin/security', element: <AdminSecurityPage /> },
          { path: '/security', element: <SecurityPage /> },
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
        <StepUpDialog />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
