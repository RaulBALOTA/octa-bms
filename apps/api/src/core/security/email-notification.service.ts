import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { hashIdentifier } from './crypto';
import { SecurityAuditService } from './security-audit.service';

export type SecurityEmail =
  | { kind: 'password-reset'; link: string; minutes: number }
  | { kind: 'invitation'; link: string; companyName: string; hours: number }
  | { kind: 'password-changed' }
  | { kind: 'mfa-enabled' }
  | { kind: 'mfa-disabled' }
  | { kind: 'mfa-reset' }
  | { kind: 'recovery-codes-rotated' }
  | { kind: 'recovery-code-used'; remaining: number }
  | { kind: 'new-sign-in'; when: string; device: string }
  | { kind: 'account-disabled' }
  | { kind: 'role-granted'; role: string }
  | { kind: 'passkey-added'; name: string }
  | { kind: 'passkey-removed' };

const NOT_YOU = 'If this was not you, contact your OCTA BMS administrator immediately.';

function render(email: SecurityEmail, appUrl: string): { subject: string; text: string } {
  const security = `${appUrl}/security`;
  switch (email.kind) {
    case 'password-reset':
      return { subject: 'OCTA BMS password reset', text: `A password reset was requested for your OCTA BMS account.\n\nOpen this link within ${email.minutes} minutes to choose a new password:\n${email.link}\n\nIf you did not request this, ignore this email — your password is unchanged.` };
    case 'invitation':
      return { subject: `Invitation to OCTA BMS (${email.companyName})`, text: `You have been invited to OCTA BMS for ${email.companyName}.\n\nAccept within ${email.hours} hours:\n${email.link}\n\nYou will set a password and register Microsoft Authenticator.` };
    case 'password-changed':
      return { subject: 'Your OCTA BMS password was changed', text: `Your password was changed and other sessions were signed out.\n\n${NOT_YOU}\n${security}` };
    case 'mfa-enabled':
      return { subject: 'Authenticator app registered', text: `An authenticator app was registered for two-step verification on your account.\n\n${NOT_YOU}\n${security}` };
    case 'mfa-disabled':
      return { subject: 'Two-step verification turned off', text: `Two-step verification was turned off for your account.\n\n${NOT_YOU}\n${security}` };
    case 'mfa-reset':
      return { subject: 'Two-step verification was reset by an administrator', text: `An administrator reset two-step verification after an approved recovery request. All sessions were signed out; you must register an authenticator at next sign-in.\n\n${NOT_YOU}` };
    case 'recovery-codes-rotated':
      return { subject: 'New recovery codes generated', text: `New recovery codes were generated; previous codes no longer work.\n\n${NOT_YOU}\n${security}` };
    case 'recovery-code-used':
      return { subject: 'A recovery code was used to sign in', text: `A recovery code was used to sign in. ${email.remaining} codes remain.\n\n${NOT_YOU}\n${security}` };
    case 'new-sign-in':
      return { subject: 'New sign-in to OCTA BMS', text: `New sign-in at ${email.when} (${email.device}).\n\n${NOT_YOU}\n${security}` };
    case 'account-disabled':
      return { subject: 'Your OCTA BMS account was disabled', text: `Your account was disabled and all sessions ended.\n\n${NOT_YOU}` };
    case 'passkey-added':
      return { subject: 'Passkey added to your OCTA BMS account', text: `A passkey ("${email.name}") was registered for your account.\n\n${NOT_YOU}\n${security}` };
    case 'passkey-removed':
      return { subject: 'Passkey removed from your OCTA BMS account', text: `A passkey was removed from your account.\n\n${NOT_YOU}\n${security}` };
    case 'role-granted':
      return { subject: 'New role on your OCTA BMS account', text: `The role "${email.role}" was granted to your account.\n\n${NOT_YOU}\n${security}` };
  }
}

/**
 * Transactional security email. Links are built only from APP_PUBLIC_ORIGIN, never from
 * request data. Delivery is non-blocking for notifications; failures are recorded as
 * `email.delivery` security events (visible in admin diagnostics) without the content.
 */
@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger('SecurityEmail');
  private transporter: Transporter | null | undefined;
  /** Test hook: last messages (only populated when MAIL_TRANSPORT=memory). */
  readonly outbox: { to: string; subject: string; text: string }[] = [];

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly audit: SecurityAuditService,
  ) {}

  get appUrl(): string {
    return this.config.publicOrigin;
  }

  get configured(): boolean {
    return process.env.MAIL_TRANSPORT === 'memory' || Boolean(process.env.SMTP_HOST);
  }

  private getTransport(): Transporter | null {
    if (this.transporter !== undefined) return this.transporter;
    const host = process.env.SMTP_HOST;
    this.transporter = host
      ? createTransport({
          host,
          port: Number(process.env.SMTP_PORT ?? 587),
          secure: process.env.SMTP_SECURE === 'true',
          requireTLS: this.config.production,
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
        })
      : null;
    return this.transporter;
  }

  async send(to: string, email: SecurityEmail, userId?: string): Promise<boolean> {
    const { subject, text } = render(email, this.appUrl);
    let ok = false;
    try {
      if (process.env.MAIL_TRANSPORT === 'memory') {
        this.outbox.push({ to, subject, text });
        ok = true;
      } else {
        const transport = this.getTransport();
        if (transport) {
          await transport.sendMail({ from: process.env.MAIL_FROM ?? 'no-reply@localhost', to, subject, text });
          ok = true;
        }
      }
    } catch (error) {
      this.logger.warn(`delivery failed (${email.kind}): ${error instanceof Error ? error.name : 'error'}`);
    }
    if (!ok) {
      // never log the body — it may contain a reset/invite link
      this.logger.warn(`email not delivered (${email.kind}) to recipient ${hashIdentifier(to)}`);
      await this.audit.record({ action: 'email.delivery', outcome: 'failure', targetUserId: userId, context: { kind: email.kind, configured: this.configured } });
    }
    return ok;
  }

  /** Fire-and-forget for notifications that must not block the security operation. */
  notify(to: string, email: SecurityEmail, userId?: string): void {
    void this.send(to, email, userId);
  }
}
