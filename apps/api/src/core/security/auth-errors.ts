import { HttpException, HttpStatus } from '@nestjs/common';

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'SESSION_POLICY_REAUTH'
  | 'MFA_CHALLENGE_INVALID'
  | 'MFA_CODE_INVALID'
  | 'MFA_ENROLLMENT_INVALID'
  | 'MFA_NOT_ENROLLED'
  | 'MFA_REQUIRED_BY_POLICY'
  | 'RECOVERY_CODE_INVALID'
  | 'STEP_UP_REQUIRED'
  | 'STEP_UP_INVALID'
  | 'CSRF_REJECTED'
  | 'TOKEN_INVALID'
  | 'PASSWORD_POLICY'
  | 'FORBIDDEN'
  | 'POLICY_CHANGE_REJECTED'
  | 'RECOVERY_REQUEST_INVALID'
  | 'PASSKEY_INVALID'
  | 'PASSKEY_REQUIRED';

const STATUS: Record<AuthErrorCode, HttpStatus> = {
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  TOO_MANY_ATTEMPTS: HttpStatus.TOO_MANY_REQUESTS,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  SESSION_EXPIRED: HttpStatus.UNAUTHORIZED,
  SESSION_POLICY_REAUTH: HttpStatus.UNAUTHORIZED,
  MFA_CHALLENGE_INVALID: HttpStatus.UNAUTHORIZED,
  MFA_CODE_INVALID: HttpStatus.UNAUTHORIZED,
  MFA_ENROLLMENT_INVALID: HttpStatus.BAD_REQUEST,
  MFA_NOT_ENROLLED: HttpStatus.CONFLICT,
  MFA_REQUIRED_BY_POLICY: HttpStatus.CONFLICT,
  RECOVERY_CODE_INVALID: HttpStatus.UNAUTHORIZED,
  STEP_UP_REQUIRED: HttpStatus.FORBIDDEN,
  STEP_UP_INVALID: HttpStatus.UNAUTHORIZED,
  CSRF_REJECTED: HttpStatus.FORBIDDEN,
  TOKEN_INVALID: HttpStatus.BAD_REQUEST,
  PASSWORD_POLICY: HttpStatus.BAD_REQUEST,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  POLICY_CHANGE_REJECTED: HttpStatus.CONFLICT,
  RECOVERY_REQUEST_INVALID: HttpStatus.CONFLICT,
  PASSKEY_INVALID: HttpStatus.UNAUTHORIZED,
  PASSKEY_REQUIRED: HttpStatus.FORBIDDEN,
};

const MESSAGES: Partial<Record<AuthErrorCode, string>> = {
  INVALID_CREDENTIALS: 'Invalid email or password',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Please wait and try again.',
  UNAUTHENTICATED: 'Authentication required',
  SESSION_EXPIRED: 'Your session has expired',
  SESSION_POLICY_REAUTH: 'Please sign in again to complete security setup',
  MFA_CHALLENGE_INVALID: 'The sign-in attempt expired. Please sign in again.',
  MFA_CODE_INVALID: 'The code is not valid',
  RECOVERY_CODE_INVALID: 'The recovery code is not valid',
  STEP_UP_REQUIRED: 'Please confirm your identity to continue',
  STEP_UP_INVALID: 'Verification failed',
  CSRF_REJECTED: 'Request rejected',
  TOKEN_INVALID: 'This link is invalid or has expired',
  FORBIDDEN: 'Not permitted',
  PASSKEY_INVALID: 'Passkey verification failed',
  PASSKEY_REQUIRED: 'Your organization requires a passkey for administrator accounts',
};

/** Typed, non-leaking authentication error: `{ code, message, ...details }`. */
export class AuthError extends HttpException {
  constructor(readonly code: AuthErrorCode, message?: string, details: Record<string, unknown> = {}) {
    super({ statusCode: STATUS[code], code, message: message ?? MESSAGES[code] ?? code, ...details }, STATUS[code]);
  }
}
