import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * LIVE end-to-end check (no mocks): real API + PostgreSQL + browser. Opt-in:
 *   OCTA_LIVE_EMAIL=… OCTA_LIVE_PASSWORD=… pnpm --filter @octa-bms/web test:e2e auth-live
 * The account must exist, have no authenticator yet, and the policy must be "optional".
 * TOTP codes are computed here with an independent RFC 6238 implementation (node:crypto),
 * exactly as Microsoft Authenticator would from the manual key shown on screen.
 */
const EMAIL = process.env.OCTA_LIVE_EMAIL;
const PASSWORD = process.env.OCTA_LIVE_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'set OCTA_LIVE_EMAIL / OCTA_LIVE_PASSWORD to run against a live API');
test.describe.configure({ mode: 'serial' });

function base32(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/[\s=]/g, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}

function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

let manualKey = '';
let recoveryCodes: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('octa-bms-lang', 'en'));
});

test('signs in, cookie is HttpOnly/SameSite=Strict and invisible to scripts', async ({ page, context }) => {
  await signIn(page);
  await expect(page).toHaveURL('/');
  const session = (await context.cookies()).find((c) => c.name.endsWith('bms_session'))!;
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe('Strict');
  expect(session.path).toBe('/');
  expect(await page.evaluate(() => document.cookie)).not.toContain(session.value);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(session.value);
});

test('enrolls Microsoft Authenticator from the security center', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL('/');
  await page.goto('/security');
  await page.getByRole('link', { name: 'Set up authenticator' }).click();
  await page.getByRole('button', { name: 'Start setup' }).click();
  await expect(page.getByAltText('QR code for adding OCTA BMS to Microsoft Authenticator')).toBeVisible();
  await page.getByText('Can’t scan? Enter this key manually').click();
  manualKey = (await page.getByLabel('Can’t scan? Enter this key manually').textContent())!.trim();
  expect(manualKey.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('6-digit code').fill(totp(manualKey));
  await page.getByRole('button', { name: 'Confirm and activate' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  recoveryCodes = (await page.getByRole('list', { name: 'Save your recovery codes' }).locator('li').allTextContents()).map((c) => c.trim());
  expect(recoveryCodes).toHaveLength(10);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(recoveryCodes[0]);
  await page.getByLabel(/I stored these codes/).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL('/security');
  await expect(page.getByText('On — Microsoft Authenticator')).toBeVisible();
});

test('password alone no longer opens the app; the authenticator code does', async ({ page, context }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/auth\/mfa/);
  expect((await context.cookies()).some((c) => c.name.endsWith('bms_session'))).toBe(false);
  const direct = await page.request.get('/api/v1/auth/me');
  expect(direct.status()).toBe(401);
  await page.getByLabel('6-digit code').fill(totp(manualKey, Date.now() + 30_000)); // next step: enrollment used the current one
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/');
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);
});

test('recovery code signs in once', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Use a recovery code instead' }).click();
  await page.getByRole('textbox', { name: 'Recovery code' }).fill(recoveryCodes[0]);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Signed in. 9 recovery codes remain.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL('/');
  await page.context().clearCookies();
  await signIn(page);
  await page.getByRole('link', { name: 'Use a recovery code instead' }).click();
  await page.getByRole('textbox', { name: 'Recovery code' }).fill(recoveryCodes[0]);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert').first()).toContainText('not valid or was already used');
});
