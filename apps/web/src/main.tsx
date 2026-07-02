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
import { LeavePage } from './pages/LeavePage';
import { LoginPage } from './pages/LoginPage';
import { PartnersPage } from './pages/PartnersPage';
import { PipelinePage } from './pages/PipelinePage';
import { useAuthStore } from './stores/auth';

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
          { path: '/hr/employees', element: <EmployeesPage /> },
          { path: '/hr/employees/:id', element: <EmployeesPage /> },
          { path: '/hr/leave', element: <LeavePage /> },
          { path: '/assets', element: <AssetsPage /> },
          { path: '/assets/:id', element: <AssetsPage /> },
          { path: '/admin', element: <AdminPage /> },
          { path: '/contracts', element: <ContractsPage /> },
          { path: '/finance/invoices', element: <InvoicesPage /> },
          { path: '/finance/invoices/:id', element: <InvoicesPage /> },
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
