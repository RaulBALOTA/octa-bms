import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { FinanceNav } from '../components/FinanceNav';
import { Button, Field, TextInput, useToast } from '../components/ui';

export function DatevPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const { data: pending } = useQuery({
    queryKey: ['datev-pending'],
    queryFn: () => api.get<{ count: number }>('/finance/datev/pending-count'),
  });

  const exportFile = async () => {
    setBusy(true);
    try {
      await api.download(
        `/finance/datev/export?from=${from}&to=${to}`,
        `EXTF_Buchungsstapel_${year}.csv`,
      );
      void queryClient.invalidateQueries({ queryKey: ['datev-pending'] });
      toast(t('finance.datevExported'));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <FinanceNav />
      <div className="mx-auto max-w-xl">
        <h1 className="mb-1 text-lg font-bold">DATEV Export</h1>
        <p className="mb-5 text-sm text-muted-foreground">{t('finance.datevIntro')}</p>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-muted/50 p-3">
            <FileSpreadsheet size={20} className="text-primary" />
            <div className="text-sm">
              <strong>{pending?.count ?? '…'}</strong> {t('finance.datevPending')}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <Field label={t('leave.from')} required>
              <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('leave.to')} required>
              <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>

          <Button onClick={() => void exportFile()} disabled={busy} className="w-full">
            <Download size={14} />
            {busy ? t('common.loading') : t('finance.datevExport')}
          </Button>

          <p className="mt-3 text-xs text-muted-foreground">{t('finance.datevNote')}</p>
        </div>
      </div>
    </>
  );
}
