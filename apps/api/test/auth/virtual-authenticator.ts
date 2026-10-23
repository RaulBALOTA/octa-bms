import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * Minimal software FIDO2 authenticator for tests (ES256, attestation "none", UV set).
 * It builds real CBOR attestation objects and DER ECDSA signatures, so the server's
 * @simplewebauthn verification runs unmodified.
 */
type Cbor = number | string | Buffer | Cbor[] | Map<Cbor, Cbor> | { [k: string]: Cbor };

function head(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  if (value < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(value, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(value, 1); return b;
}

export function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const s = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, s.length), s]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k as Cbor), cbor(v as Cbor)])]);
}

const b64u = (b: Buffer) => b.toString('base64url');

interface Options { challenge: string; rp?: { id?: string }; rpId?: string }

export class VirtualAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly cosePublicKey: Buffer;
  counter = 0;

  constructor(readonly origin: string, readonly rpId: string, private readonly opts: { userVerified?: boolean } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.cosePublicKey = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  }

  private authData(rpId: string, attested: boolean): Buffer {
    const flags = 0x01 /* UP */ | (this.opts.userVerified === false ? 0 : 0x04) /* UV */ | (attested ? 0x40 : 0);
    const count = Buffer.alloc(4); count.writeUInt32BE(this.counter);
    const parts = [createHash('sha256').update(rpId).digest(), Buffer.from([flags]), count];
    if (attested) {
      const len = Buffer.alloc(2); len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, this.cosePublicKey);
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** navigator.credentials.create() equivalent → RegistrationResponseJSON */
  create(options: Options, overrides: { origin?: string; rpId?: string } = {}) {
    const authData = this.authData(overrides.rpId ?? options.rp?.id ?? this.rpId, true);
    const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData });
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: b64u(this.clientData('webauthn.create', options.challenge, overrides.origin)), attestationObject: b64u(attestationObject), transports: ['internal'] },
    };
  }

  /** navigator.credentials.get() equivalent → AuthenticationResponseJSON */
  get(options: Options, overrides: { origin?: string; rpId?: string } = {}) {
    this.counter += 1;
    const authData = this.authData(overrides.rpId ?? options.rpId ?? this.rpId, false);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, overrides.origin);
    const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]), this.privateKey);
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: undefined },
    };
  }
}
