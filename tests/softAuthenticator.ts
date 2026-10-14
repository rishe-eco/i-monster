// A software passkey authenticator for the integration tests (plan B4a). An
// ES256 key pair from node:crypto builds real attestation and assertion
// responses, so every ceremony runs against the server's real verifier with no
// browser. It is not a mock of the verifier: it produces the bytes a platform
// authenticator would, so a bug in the server's checks fails here.
//
// The flags are set on purpose, because a test that passes against an
// authenticator that could not exist proves nothing:
//   UP (user present)   always on unless a test turns it off
//   UV (user verified)  on: the site requires it, and one test flips it off
//   BE (backup eligible) on by default, as a synced passkey is; BS (backed up) off
//   AT (attested credential data) on at registration only
// The sign count goes up by one at every assertion, as a device-bound key's does.
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

// ── Just enough CBOR for an attestation object and a COSE key ──

type Cbor = number | string | Buffer | Cbor[] | Map<Cbor, Cbor>;

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  if (length < 65536) return Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
  throw new RangeError('too long for this encoder');
}

function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 } as const;
const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();

export interface AuthenticatorOptions {
  origin: string;
  rpId: string;
  /** User present. On. */
  up?: boolean;
  /** User verified: PIN, fingerprint or face. On, because the site requires it. */
  uv?: boolean;
  /** Backup eligible: a synced passkey. On. */
  be?: boolean;
  /** Currently backed up. Off. */
  bs?: boolean;
}

export interface Overrides {
  /** Sign this challenge instead of the one the server sent. */
  challenge?: string;
  /** Claim this origin instead of the real one. */
  origin?: string;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32).toString('base64url');
  signCount = 0;
  up: boolean;
  uv: boolean;
  be: boolean;
  bs: boolean;
  private readonly origin: string;
  private readonly rpId: string;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private userHandle: string | undefined;

  constructor(options: AuthenticatorOptions) {
    this.origin = options.origin;
    this.rpId = options.rpId;
    this.up = options.up ?? true;
    this.uv = options.uv ?? true;
    this.be = options.be ?? true;
    this.bs = options.bs ?? false;
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  private flags(extra = 0): number {
    return (this.up ? FLAG.UP : 0) | (this.uv ? FLAG.UV : 0) | (this.be ? FLAG.BE : 0) | (this.bs ? FLAG.BS : 0) | extra;
  }

  private header(flags: number): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.signCount);
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), counter]);
  }

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, override?: Overrides): Buffer {
    return Buffer.from(
      JSON.stringify({ type, challenge: override?.challenge ?? challenge, origin: override?.origin ?? this.origin, crossOrigin: false }),
      'utf8',
    );
  }

  /** What `navigator.credentials.create` would return, as the browser library's JSON. Refuses as a browser does when the credential is excluded. */
  register(options: PublicKeyCredentialCreationOptionsJSON, override?: Overrides): RegistrationResponseJSON {
    if (options.excludeCredentials?.some((c) => c.id === this.credentialId)) {
      throw new Error('InvalidStateError: a credential on this authenticator is excluded');
    }
    this.userHandle = options.user.id;
    const jwk = this.publicKey.export({ format: 'jwk' });
    const coseKey = cbor(
      new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ]),
    );
    const id = Buffer.from(this.credentialId, 'base64url');
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(id.length);
    const authData = Buffer.concat([this.header(this.flags(FLAG.AT)), Buffer.alloc(16), idLength, id, coseKey]);
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map<Cbor, Cbor>()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.clientData('webauthn.create', options.challenge, override).toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        transports: ['internal'],
        publicKeyAlgorithm: -7,
        publicKey: this.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      },
    };
  }

  /** What `navigator.credentials.get` would return. The sign count goes up by one first. */
  assert(options: PublicKeyCredentialRequestOptionsJSON, override?: Overrides): AuthenticationResponseJSON {
    this.signCount += 1;
    const clientData = this.clientData('webauthn.get', options.challenge, override);
    const authData = this.header(this.flags());
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: this.userHandle,
      },
    };
  }
}
