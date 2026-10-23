import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Browser-level auth flows against a mocked API that mirrors the server contract
 * (state machine, CSRF header, one-time recovery codes). Server-side enforcement is
 * covered by apps/api/test/auth/*.int.spec.ts against PostgreSQL.
 */
interface Mock { state: string; csrf: string; mutations: { path: string; csrf?: string; body: unknown }[] }

async function mockApi(page: Page, initial: string): Promise<Mock> {
  const mock: Mock = { state: initial, csrf: 'csrf-1', mutations: [] };
  await page.addInitScript(() => {
    localStorage.setItem('octa-bms-lang', 'en');
    // legacy v1 store with tokens: the app must discard them on load
    localStorage.setItem('octa-bms-auth', JSON.stringify({ state: { accessToken: 'legacy-access', refreshToken: 'legacy-refresh', companyId: 'company' }, version: 0 }));
  });
  await page.route('**/api/v1/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    if (req.method() !== 'GET') mock.mutations.push({ path, csrf: req.headers()['x-csrf-token'], body: req.postDataJSON?.() });
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    switch (path) {
      case '/auth/state': return json(mock.state === 'ANONYMOUS' ? { state: 'ANONYMOUS' } : { state: mock.state, csrfToken: mock.csrf });
      case '/auth/config': return json({ passwordMinLength: 12, mfaIssuer: 'OCTA BMS' });
      case '/auth/oidc/status': return json({ enabled: false });
      case '/auth/login': {
        const body = req.postDataJSON() as { email: string; password: string };
        if (body.password !== 'tangerine orbit lantern 42') return json({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }, 401);
        mock.state = body.email.startsWith('new') ? 'MFA_ENROLLMENT_REQUIRED' : 'MFA_PENDING';
        mock.csrf = 'csrf-challenge';
        return json({ status: mock.state, csrfToken: mock.csrf });
      }
      case '/auth/mfa/verify': {
        const { code } = req.postDataJSON() as { code: string };
        if (code !== '123456') return json({ statusCode: 401, code: 'MFA_CODE_INVALID', message: 'The code is not valid', attemptsRemaining: 4 }, 401);
        mock.state = 'AUTHENTICATED'; mock.csrf = 'csrf-session';
        return json({ status: 'AUTHENTICATED', csrfToken: mock.csrf });
      }
      case '/auth/mfa/enroll/start':
        return json({ enrollmentId: 'enr-1', qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', manualKey: 'JBSW Y3DP EHPK 3PXP', issuer: 'OCTA BMS', accountName: 'new@octa.test', algorithm: 'SHA1', digits: 6, period: 30, expiresAt: new Date(Date.now() + 900_000).toISOString() });
      case '/auth/mfa/enroll/confirm':
        mock.state = 'AUTHENTICATED'; mock.csrf = 'csrf-session';
        return json({ status: 'AUTHENTICATED', csrfToken: mock.csrf, recoveryCodes: Array.from({ length: 10 }, (_, i) => `ABCDE-FGH${i}${i}`.slice(0, 11)) });
      case '/auth/me':
        if (mock.state !== 'AUTHENTICATED') return json({ statusCode: 401, code: 'UNAUTHENTICATED' }, 401);
        return json({ id: 'u1', email: 'staff@octa.test', firstName: 'Staff', lastName: 'User', isSystemAdmin: false, permissions: [], memberships: [{ isDefault: true, company: { id: 'company', code: 'C', name: 'Company' } }], mfa: { enrolled: true, recoveryCodesRemaining: 10, required: true } });
      case '/auth/logout': mock.state = 'ANONYMOUS'; return route.fulfill({ status: 204 });
      default:
        if (mock.state !== 'AUTHENTICATED') return json({ statusCode: 401, code: 'UNAUTHENTICATED' }, 401);
        return json(path.endsWith('unread-count') ? { count: 0 } : []);
    }
  });
  return mock;
}

test('legacy tokens are purged and protected routes redirect to sign-in', async ({ page }) => {
  await mockApi(page, 'ANONYMOUS');
  await page.goto('/finance/invoices');
  await expect(page).toHaveURL(/\/login\?next=%2Ffinance%2Finvoices/);
  const stored = await page.evaluate(() => localStorage.getItem('octa-bms-auth') ?? '');
  expect(stored).not.toContain('legacy-access');
  expect(stored).not.toContain('legacy-refresh');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/csrf|token/i);
});

test('password + TOTP sign-in with neutral errors, CSRF header and safe redirect', async ({ page }) => {
  const mock = await mockApi(page, 'ANONYMOUS');
  await page.goto('/login?next=//evil.example/steal');
  await page.getByLabel('Email').fill('staff@octa.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').first()).toHaveText('Invalid email or password.');

  await page.getByLabel('Password', { exact: true }).fill('tangerine orbit lantern 42');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/auth\/mfa/);
  const code = page.getByLabel('6-digit code');
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await code.fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert').first()).toContainText('4 attempts left');
  await code.fill('123 456'); // pasted with a space
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/'); // open redirect neutralised
  const verify = mock.mutations.filter((m) => m.path === '/auth/mfa/verify').at(-1)!;
  expect(verify.csrf).toBe('csrf-challenge');
  expect(verify.body).toEqual({ code: '123456' });
});

test('enrollment-required sign-in: Authenticator setup, one-time recovery codes with acknowledgement', async ({ page }) => {
  await mockApi(page, 'ANONYMOUS');
  await page.goto('/login');
  await page.getByLabel('Email').fill('new@octa.test');
  await page.getByLabel('Password', { exact: true }).fill('tangerine orbit lantern 42');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/auth\/setup-mfa/);
  await expect(page.getByText('Tap + and choose “Other account (Google, Facebook, etc.)”.')).toBeVisible();
  await page.getByRole('button', { name: 'Start setup' }).click();
  await expect(page.getByAltText('QR code for adding OCTA BMS to Microsoft Authenticator')).toBeVisible();
  await page.getByText('Can’t scan? Enter this key manually').click();
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Confirm and activate' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toHaveCount(0); // secret gone after activation
  const cont = page.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await page.getByLabel(/I stored these codes/).check();
  await cont.click();
  await expect(page).toHaveURL('/');
});

test('auth pages are keyboard-operable and German strings are available', async ({ page }) => {
  await mockApi(page, 'ANONYMOUS');
  await page.goto('/login');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Auf Deutsch umschalten' }).click();
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Passwort vergessen?' })).toBeVisible();
  await page.getByRole('link', { name: 'Passwort vergessen?' }).click();
  await expect(page.getByRole('heading', { name: 'Passwort zurücksetzen' })).toBeVisible();
});

async function mockAdminApi(page: Page, opts: { systemAdmin: boolean; rejectWith?: string }) {
  const saved: unknown[] = [];
  const policy = { mfaMode: 'OPTIONAL', enrollmentDeadline: null, sessionIdleMinutes: 60, sessionAbsoluteHours: 12, stepUpMaxAgeMinutes: 10, passkeysEnabled: true, requirePasskeyForAdmins: false, source: 'environment' };
  await page.addInitScript(() => localStorage.setItem('octa-bms-lang', 'en'));
  await page.route('**/api/v1/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/auth/state') return json({ state: 'AUTHENTICATED', csrfToken: 'csrf-admin' });
    if (path === '/auth/me') return json({ id: 'a1', email: 'admin@octa.test', firstName: 'Ada', lastName: 'Admin', isSystemAdmin: opts.systemAdmin, permissions: ['identity.security.read'], memberships: [{ isDefault: true, company: { id: 'c', code: 'C', name: 'Company' } }], mfa: { enrolled: true, totp: true, passkeys: 1, recoveryCodesRemaining: 10, required: true, passkeyEligible: true } });
    if (path === '/admin/security/overview') return json({ users: 12, enrolled: 9, notEnrolled: 3, pendingEnrollments: 1, activeSessions: 4, pendingRecovery: 0, enrolledAdmins: 2, systemAdmins: 2, adminsWithPasskey: 1, policy });
    if (path === '/admin/security/config') return json({ totp: { issuer: 'OCTA BMS', algorithm: 'SHA1', digits: 6, periodSeconds: 30, windowSteps: 1 }, challenge: { preAuthTtlSeconds: 300, enrollTtlSeconds: 900, maxAttempts: 5 }, sessionDefaults: { idleMinutes: 60, absoluteHours: 12, stepUpMaxAgeMinutes: 10 }, passkeys: { rpId: 'localhost', rpName: 'OCTA BMS', userVerification: 'required', attestation: 'none' }, passwords: { minLength: 12, breachedCheck: false }, email: { configured: true }, encryptionKey: { id: 'dev-insecure', development: true } });
    if (path === '/admin/security/policy' && req.method() === 'PATCH') {
      saved.push({ body: req.postDataJSON(), csrf: req.headers()['x-csrf-token'] });
      if (opts.rejectWith) return json({ statusCode: 409, code: 'POLICY_CHANGE_REJECTED', message: opts.rejectWith }, 409);
      Object.assign(policy, req.postDataJSON(), { source: 'database' });
      return json(policy);
    }
    return json(path.endsWith('unread-count') ? { count: 0 } : []);
  });
  return saved;
}

test('MFA configuration page: readiness, mode, methods and saving', async ({ page }) => {
  const saved = await mockAdminApi(page, { systemAdmin: true });
  await page.goto('/admin/security/mfa');
  await expect(page.getByRole('heading', { name: 'MFA configuration' })).toBeVisible();
  await expect(page.getByText('At least two system administrators have a second factor (2)')).toBeVisible();
  await expect(page.getByText('System administrators with a passkey: 1 of 2')).toBeVisible();
  await expect(page.getByText(/Microsoft Authenticator compatible · SHA1 · 6 digits · 30 s/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save configuration' })).toBeDisabled();

  await page.getByRole('radio', { name: /Enrollment required/ }).check();
  await page.getByLabel('Enrollment deadline').fill('2026-12-01T09:00');
  await page.getByRole('switch', { name: 'Require passkeys for system administrators' }).check();
  await page.getByLabel('Re-verification window (minutes)').fill('5');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  // turning passkeys off also clears the admin requirement
  await page.getByRole('switch', { name: 'Allow passkeys' }).uncheck();
  await expect(page.getByRole('switch', { name: 'Require passkeys for system administrators' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Require passkeys for system administrators' })).toBeDisabled();
  await page.getByRole('switch', { name: 'Allow passkeys' }).check();
  await page.getByRole('switch', { name: 'Require passkeys for system administrators' }).check();
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(page.getByText('MFA configuration saved')).toBeVisible();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    csrf: 'csrf-admin',
    body: { mfaMode: 'ENROLLMENT_REQUIRED', passkeysEnabled: true, requirePasskeyForAdmins: true, stepUpMaxAgeMinutes: 5, sessionIdleMinutes: 60, sessionAbsoluteHours: 12 },
  });
});

test('MFA configuration shows server guard-rail rejections and is read-only for non-system admins', async ({ page, context }) => {
  await mockAdminApi(page, { systemAdmin: true, rejectWith: 'Every system administrator (at least two) must register a passkey before passkeys can be required' });
  await page.goto('/admin/security/mfa');
  await page.getByRole('switch', { name: 'Require passkeys for system administrators' }).check();
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'must register a passkey' })).toBeVisible();

  const other = await context.newPage();
  await mockAdminApi(other, { systemAdmin: false });
  await other.goto('/admin/security/mfa');
  await expect(other.getByText('Only system administrators can change these settings.')).toBeVisible();
  await expect(other.getByRole('switch', { name: 'Allow passkeys' })).toBeDisabled();
  await expect(other.getByRole('button', { name: 'Save configuration' })).toHaveCount(0);
});
