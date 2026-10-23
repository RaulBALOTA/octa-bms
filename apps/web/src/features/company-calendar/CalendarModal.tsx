import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
/** Native modal provides focus containment, inert background and Escape support. */
export function CalendarModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId(); const { t } = useTranslation();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); dialog?.querySelector<HTMLElement>('[data-calendar-autofocus]')?.focus(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} className="m-auto max-h-[90dvh] w-[min(720px,94vw)] overflow-y-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/40">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-4"><h2 id={titleId} className="text-lg font-semibold">{title}</h2><button className="rounded p-2 focus-visible:ring-2 focus-visible:ring-primary" aria-label={t('calendar.close')} onClick={onClose}><X size={18}/></button></div><div className="p-4">{children}</div>
  </dialog>;
}
