import { useTranslation } from 'react-i18next';
import { SubNav } from './SubNav';

export function FinanceNav() {
  const { t } = useTranslation();
  return (
    <SubNav
      items={[
        { label: t('finance.title'), to: '/finance/invoices' },
        { label: t('finance.payments'), to: '/finance/payments' },
        { label: t('banking.nav'), to: '/finance/banking' },
        { label: t('finance.openItems'), to: '/finance/open-items' },
        { label: t('finance.dunning'), to: '/finance/dunning' },
        { label: t('finance.cashflow'), to: '/finance/cashflow' },
        { label: t('finance.budgets'), to: '/finance/budgets' },
        { label: t('staffing.title'), to: '/hr/staffing-budgets' },
        { label: 'DATEV', to: '/finance/datev' },
      ]}
    />
  );
}
