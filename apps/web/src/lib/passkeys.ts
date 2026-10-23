import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

export const passkeysSupported = () => browserSupportsWebAuthn();

/** 'cancelled' when the user dismissed the browser/OS prompt (no error message needed). */
export class PasskeyCeremonyError extends Error {
  constructor(public reason: 'cancelled' | 'unsupported' | 'failed') {
    super(reason);
  }
}

function mapError(error: unknown): never {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyCeremonyError('cancelled');
  if (name === 'NotSupportedError' || name === 'SecurityError') throw new PasskeyCeremonyError('unsupported');
  throw new PasskeyCeremonyError('failed');
}

export async function createPasskey(optionsJSON: PublicKeyCredentialCreationOptionsJSON) {
  if (!passkeysSupported()) throw new PasskeyCeremonyError('unsupported');
  return startRegistration({ optionsJSON }).catch(mapError);
}

export async function getPasskeyAssertion(optionsJSON: PublicKeyCredentialRequestOptionsJSON) {
  if (!passkeysSupported()) throw new PasskeyCeremonyError('unsupported');
  return startAuthentication({ optionsJSON }).catch(mapError);
}
