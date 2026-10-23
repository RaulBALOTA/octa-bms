import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WebAuthnChallengePurpose, WebAuthnCredential } from '@prisma/client';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { AuthError } from './auth-errors';
import { RecoveryService } from './recovery.service';

const CHALLENGE_TTL_MS = 5 * 60_000;
type Db = PrismaService | Prisma.TransactionClient;

/** Admin-facing summary — never includes key material. */
export type PasskeySummary = Pick<WebAuthnCredential, 'id' | 'name' | 'deviceType' | 'backedUp' | 'createdAt' | 'lastUsedAt'> & { transports: string[] };

function challengeFrom(response: { response: { clientDataJSON: string } }): string | null {
  try {
    const data = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')) as { challenge?: unknown };
    return typeof data.challenge === 'string' && data.challenge.length <= 128 ? data.challenge : null;
  } catch {
    return null;
  }
}

/**
 * Passkeys (WebAuthn, FIDO2) as a phishing-resistant factor for administrators.
 * - user verification required (biometric / device PIN), attestation "none" (privacy);
 * - every ceremony uses a single-use server challenge bound to the session or pre-auth
 *   challenge that requested it (5 min TTL), consumed atomically before verification;
 * - the origin and RP ID are checked by the browser *and* the server, so a look-alike
 *   phishing domain cannot obtain a valid assertion.
 */
@Injectable()
export class PasskeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recovery: RecoveryService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** System administrators and holders of identity.security.update (in any company). */
  async isEligible(userId: string, db: Db = this.prisma): Promise<boolean> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
    if (!user) return false;
    if (user.isSystemAdmin) return true;
    const grants = await db.userRole.count({
      where: { userId, role: { deletedAt: null, permissions: { some: { permission: { code: 'identity.security.update' } } } } },
    });
    return grants > 0;
  }

  active(userId: string, db: Db = this.prisma) {
    return db.webAuthnCredential.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  async list(userId: string): Promise<PasskeySummary[]> {
    return (await this.active(userId)).map(({ id, name, deviceType, backedUp, createdAt, lastUsedAt, transports }) => ({ id, name, deviceType, backedUp, createdAt, lastUsedAt, transports }));
  }

  count(userId: string, db: Db = this.prisma): Promise<number> {
    return db.webAuthnCredential.count({ where: { userId, revokedAt: null } });
  }

  private async issueChallenge(userId: string, purpose: WebAuthnChallengePurpose, bindingId: string, challenge: string) {
    // one live ceremony per binding: older pending challenges are invalidated
    await this.prisma.webAuthnChallenge.updateMany({ where: { userId, purpose, bindingId, consumedAt: null }, data: { consumedAt: new Date() } });
    await this.prisma.webAuthnChallenge.create({ data: { userId, purpose, bindingId, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } });
  }

  /** Atomically consumes the challenge echoed in clientDataJSON; returns it or throws. */
  private async consumeChallenge(userId: string, purpose: WebAuthnChallengePurpose, bindingId: string, response: { response: { clientDataJSON: string } }): Promise<string> {
    const challenge = challengeFrom(response);
    if (!challenge) throw new AuthError('PASSKEY_INVALID');
    const { count } = await this.prisma.webAuthnChallenge.updateMany({
      where: { challenge, userId, purpose, bindingId, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (count !== 1) throw new AuthError('PASSKEY_INVALID', 'This passkey request expired. Try again.');
    return challenge;
  }

  async registrationOptions(user: { id: string; email: string; displayName?: string | null }, sessionId: string) {
    const existing = await this.active(user.id);
    if (existing.length >= 10) throw new AuthError('PASSKEY_INVALID', 'You can register at most 10 passkeys');
    const options = await generateRegistrationOptions({
      rpName: this.config.webauthn.rpName,
      rpID: this.config.webauthn.rpId,
      userName: user.email,
      userDisplayName: user.displayName ?? user.email,
      // opaque, non-PII user handle
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      supportedAlgorithmIDs: [-7, -257], // ES256, RS256
      timeout: CHALLENGE_TTL_MS,
    });
    await this.issueChallenge(user.id, 'REGISTER', sessionId, options.challenge);
    return options;
  }

  /**
   * Verifies attestation and stores the credential. If this is the user's first factor,
   * a recovery-code batch is generated and returned (once).
   */
  async register(userId: string, sessionId: string, response: RegistrationResponseJSON, name: string): Promise<{ passkey: PasskeySummary; recoveryCodes?: string[] }> {
    const expectedChallenge = await this.consumeChallenge(userId, 'REGISTER', sessionId, response);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.config.webauthn.origins,
        expectedRPID: this.config.webauthn.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new AuthError('PASSKEY_INVALID');
    }
    if (!verification.verified) throw new AuthError('PASSKEY_INVALID');
    const info = verification.registrationInfo;
    return this.prisma.$transaction(async (tx) => {
      const hadFactor = (await tx.mfaAuthenticator.count({ where: { userId, status: 'ACTIVE' } })) + (await this.count(userId, tx)) > 0;
      const created = await tx.webAuthnCredential.create({
        data: {
          userId,
          credentialId: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: BigInt(info.credential.counter),
          transports: (info.credential.transports ?? []).slice(0, 8),
          aaguid: info.aaguid,
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          name: name.trim().slice(0, 60) || 'Passkey',
        },
      });
      let recoveryCodes: string[] | undefined;
      if (!hadFactor) {
        recoveryCodes = await this.recovery.generate(userId, tx);
        await tx.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaEnrolledAt: new Date() } });
      }
      const { id, deviceType, backedUp, createdAt, lastUsedAt, transports } = created;
      return { passkey: { id, name: created.name, deviceType, backedUp, createdAt, lastUsedAt, transports }, recoveryCodes };
    }).catch((error: unknown) => {
      if ((error as { code?: string }).code === 'P2002') throw new AuthError('PASSKEY_INVALID', 'This passkey is already registered');
      throw error;
    });
  }

  async authenticationOptions(userId: string, purpose: 'AUTHENTICATE' | 'STEP_UP', bindingId: string) {
    const credentials = await this.active(userId);
    if (!credentials.length) throw new AuthError('PASSKEY_INVALID', 'No passkey is registered for this account');
    const options = await generateAuthenticationOptions({
      rpID: this.config.webauthn.rpId,
      allowCredentials: credentials.map((c) => ({ id: c.credentialId, transports: c.transports })),
      userVerification: 'required',
      timeout: CHALLENGE_TTL_MS,
    });
    await this.issueChallenge(userId, purpose, bindingId, options.challenge);
    return options;
  }

  /** Verifies an assertion for this user; updates the signature counter. */
  async authenticate(userId: string, purpose: 'AUTHENTICATE' | 'STEP_UP', bindingId: string, response: AuthenticationResponseJSON): Promise<boolean> {
    const expectedChallenge = await this.consumeChallenge(userId, purpose, bindingId, response);
    const credential = await this.prisma.webAuthnCredential.findFirst({ where: { credentialId: response.id, userId, revokedAt: null } });
    if (!credential) return false;
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.config.webauthn.origins,
        expectedRPID: this.config.webauthn.rpId,
        requireUserVerification: true,
        credential: { id: credential.credentialId, publicKey: new Uint8Array(credential.publicKey), counter: Number(credential.counter), transports: credential.transports },
      });
    } catch {
      return false;
    }
    if (!verification.verified) return false;
    const { count } = await this.prisma.webAuthnCredential.updateMany({
      where: { id: credential.id, revokedAt: null },
      data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date(), backedUp: verification.authenticationInfo.credentialBackedUp },
    });
    return count === 1;
  }

  async rename(userId: string, id: string, name: string) {
    const { count } = await this.prisma.webAuthnCredential.updateMany({ where: { id, userId, revokedAt: null }, data: { name: name.trim().slice(0, 60) || 'Passkey' } });
    if (count !== 1) throw new AuthError('FORBIDDEN', 'Passkey not found');
  }

  async revoke(userId: string, id: string, db: Db = this.prisma) {
    const { count } = await db.webAuthnCredential.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count !== 1) throw new AuthError('FORBIDDEN', 'Passkey not found');
  }

  async revokeAll(userId: string, db: Db = this.prisma) {
    await db.webAuthnCredential.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.webAuthnChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
  }

  async purgeExpiredChallenges(): Promise<number> {
    const { count } = await this.prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
    return count;
  }
}
