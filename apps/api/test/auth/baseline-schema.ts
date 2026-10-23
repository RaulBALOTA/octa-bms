import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NEW_TYPES = [
  'UserStatus', 'AuthSessionRevokeReason', 'AuthSession', 'MfaFactorType', 'MfaAuthenticatorStatus', 'MfaAuthenticator',
  'MfaEnrollment', 'MfaChallengePurpose', 'MfaChallenge', 'RecoveryCode', 'MfaRecoveryStatus', 'MfaRecoveryRequest',
  'OneTimeTokenPurpose', 'OneTimeToken', 'Invitation', 'SecurityEvent', 'MfaPolicyMode', 'SecurityPolicy', 'AuthRateLimit',
];

/** Reconstructs the pre-secure-auth schema (what existing production databases have). */
export function baselineSchema(): string {
  let schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  for (const name of NEW_TYPES) {
    schema = schema.replace(new RegExp(`(?:^//[^\\n]*\\n)*^(?:model|enum) ${name} \\{[\\s\\S]*?^\\}\\n\\n?`, 'm'), '');
  }
  schema = schema.replace(/^\s*\/\/ Secure auth \(additive[^\n]*\n(?:\s*(?:status|emailNormalized|emailVerifiedAt|credentialUpdatedAt|mfaRequired|mfaEnrolledAt)\s[^\n]*\n)+/m, '\n');
  schema = schema.replace(/^\s*(?:authSessions|mfaAuthenticators|mfaEnrollments|mfaChallenges|recoveryCodes|oneTimeTokens|recoveryRequestsAsTarget|invitationsSent|invitations)\s+\w+\[\][^\n]*\n/gm, '');
  return schema;
}
