import { useTranslation } from 'react-i18next';
import { SubNav } from './SubNav';
import { hasPermission, useAuthStore } from '../stores/auth';

export function HrNav() {
  const { t } = useTranslation();
  const me = useAuthStore((state) => state.me);
  return (
    <SubNav
      items={[
        { label: t('hr.title'), to: '/hr/employees' },
        { label: t('nav.leave'), to: '/hr/leave' },
        { label: t('hr.recruitment'), to: '/hr/recruitment' },
        { label: t('hr.orgChart'), to: '/hr/org-chart' },
        ...(hasPermission(me, 'finance.budgets.read') ? [{ label: t('staffing.title'), to: '/hr/staffing-budgets' }] : []),
      ]}
    />
  );
}
