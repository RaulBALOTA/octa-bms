import { Inject, Injectable } from '@nestjs/common';
import { HOTP, Secret, TOTP } from 'otpauth';
import * as QRCode from 'qrcode';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { safeEqual } from './crypto';

/**
 * RFC 6238 TOTP profile accepted by Microsoft Authenticator ("Other account"):
 * HMAC-SHA1, 6 digits, 30-second period, Base32 secret of 160 bits.
 */
export const TOTP_PROFILE = { algorithm: 'SHA1', digits: 6, period: 30 } as const;

@Injectable()
export class TotpService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  /** 160-bit CSPRNG secret (otpauth uses crypto.getRandomValues), Base32 without padding. */
  generateSecret(): string {
    return new Secret({ size: 20 }).base32;
  }

  /** `otpauth://totp/OCTA%20BMS:user%40example.com?secret=…&issuer=OCTA%20BMS&algorithm=SHA1&digits=6&period=30` */
  provisioningUri(secretBase32: string, accountEmail: string): string {
    return new TOTP({
      issuer: this.config.mfa.issuer,
      label: accountEmail,
      issuerInLabel: true,
      secret: Secret.fromBase32(secretBase32),
      ...TOTP_PROFILE,
    }).toString();
  }

  /** QR rendered locally as SVG — the seed is never sent to a third-party service. */
  qrSvg(uri: string): Promise<string> {
    return QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  }

  /** Groups the Base32 secret for manual entry: "ABCD EFGH …". */
  formatManualKey(secretBase32: string): string {
    return secretBase32.replace(/(.{4})/g, '$1 ').trim();
  }

  currentStep(now = Date.now()): number {
    return Math.floor(now / 1000 / TOTP_PROFILE.period);
  }

  generate(secretBase32: string, step: number, digits: number = TOTP_PROFILE.digits): string {
    return HOTP.generate({ secret: Secret.fromBase32(secretBase32), algorithm: TOTP_PROFILE.algorithm, digits, counter: step });
  }

  /**
   * Returns the matched time step if `code` is valid within ±window steps AND newer than
   * `lastUsedStep`; otherwise null. Callers must persist the step atomically
   * (`UPDATE … WHERE lastUsedStep < step`) to block concurrent replay.
   */
  match(secretBase32: string, code: string, lastUsedStep: bigint | number = 0, now = Date.now()): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const current = this.currentStep(now);
    const window = this.config.mfa.window;
    let matched: number | null = null;
    // evaluate every candidate (no early exit) to keep timing independent of position
    for (let delta = -window; delta <= window; delta++) {
      const step = current + delta;
      if (safeEqual(this.generate(secretBase32, step), code) && step > Number(lastUsedStep) && matched === null) matched = step;
    }
    return matched;
  }
}
