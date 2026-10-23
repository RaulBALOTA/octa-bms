import { useTranslation } from 'react-i18next';
import { SubNav } from './SubNav';

export function ContractsNav() {
  const { t } = useTranslation();
  return (
    <SubNav
      items={[
        { label: t('contracts.title'), to: '/contracts' },
        { label: t('contracts.guarantees'), to: '/contracts/guarantees' },
        { label: t('contracts.insurance'), to: '/contracts/insurance' },
        { label: t('contracts.expiryMonitor'), to: '/contracts/expiry' },
      ]}
    />
  );
}
