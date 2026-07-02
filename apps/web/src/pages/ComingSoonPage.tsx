import { Construction } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../app/nav';

/** Placeholder for modules scheduled in later roadmap phases (doc 12). */
export function ComingSoonPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const item = NAV_ITEMS.find((n) => pathname.startsWith(n.path) && n.path !== '/');

  return (
    <div className="flex h-full flex-col items-center justify-center py-24 text-center">
      <Construction size={40} className="mb-4 text-muted-foreground" />
      <h1 className="text-lg font-bold">
        {item ? t(`nav.${item.key}`) : pathname}
      </h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        This module is part of the implementation roadmap
        (docs/12-development-roadmap.md) and ships in a later phase.
      </p>
    </div>
  );
}
