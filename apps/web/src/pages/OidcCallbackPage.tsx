import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/auth';

/**
 * Landing route for the Entra SSO redirect. The API has already put the
 * session into the httpOnly cookie; exchange it for an access token and enter
 * the app. No tokens ever appear in the URL.
 */
export function OidcCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      const { tryRefresh, loadMe } = useAuthStore.getState();
      if (await tryRefresh()) {
        await loadMe();
        navigate('/', { replace: true });
      } else {
        navigate('/login?sso=missing', { replace: true });
      }
    })();
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 size={16} className="animate-spin" />
      {t('common.loading')}
    </div>
  );
}
