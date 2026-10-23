import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/auth';

/**
 * Landing route for the Entra SSO redirect. The API puts the token pair in
 * the URL fragment (never sent to any server); we store it and enter the app.
 */
export function OidcCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    window.history.replaceState(null, '', '/oidc'); // scrub tokens from history

    if (accessToken && refreshToken) {
      useAuthStore.setState({ accessToken, refreshToken });
      void useAuthStore
        .getState()
        .loadMe()
        .then(() => navigate('/', { replace: true }));
    } else {
      navigate('/login?sso=missing', { replace: true });
    }
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 size={16} className="animate-spin" />
      {t('common.loading')}
    </div>
  );
}
