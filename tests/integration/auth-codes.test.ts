// Setup tokens and enrolment codes (AC-9, AC-20, AC-21; PD-16). One refusal,
// one body: a used, expired or unknown value of either kind answers the same
// bytes, at both steps of the ceremony.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { codeHash, issueEnrolmentCode, issueSetupToken, normaliseCode, peekCode, redeemCode } from '../../lib/codes.ts';
import { limits } from '../../lib/limits.ts';
import { validateSession } from '../../lib/sessions.ts';
import { Client, enrolmentCode, newAuthenticator, resetAuth, signedIn } from '../authHelpers.ts';
import { MINUTE, NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
const env = testEnv();
const app = testApp(t.db);
afterAll(() => t.cleanup());
beforeEach(() => {
  setNow(NOW);
  resetAuth(t.db);
});
afterEach(resetClock);

const CODE_REFUSED = JSON.stringify({ code: 'CODE_REFUSED' });
const count = (sql: string) => (t.db.prepare(sql).get() as { n: number }).n;

describe('the setup token (AC-9, AC-21)', () => {
  it('is 128 bits of base64url, printed as the /admin/setup/<token> link with its 30-minute expiry', () => {
    const issued = issueSetupToken(t.db, env);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(issued.link).toBe(`${env.origin}/admin/setup/${issued.token}`);
    expect(issued.expiresAt).toBe(NOW + limits.setupTokenMs);
    expect(limits.setupTokenMs).toBe(30 * MINUTE);
  });

  it('is stored only as a hash', () => {
    const { token } = issueSetupToken(t.db, env);
    const dump = JSON.stringify(t.db.prepare('SELECT * FROM auth_code').all());
    expect(dump).not.toContain(token);
    expect(t.db.prepare('SELECT kind, hash FROM auth_code').get()).toEqual({ kind: 'setup', hash: codeHash(token) });
  });

  it('works once: the second use is refused, and so is a second ceremony begun with it', async () => {
    const { token } = issueSetupToken(t.db, env);
    const first = await new Client(app, env).registerWithCode(newAuthenticator(env), token);
    expect(first.status).toBe(200);
    const second = new Client(app, env);
    expect((await second.post('/admin/api/auth/register/options', { code: token })).text).toBe(CODE_REFUSED);
    expect((await second.registerWithCode(newAuthenticator(env), token)).text).toBe(CODE_REFUSED);
    expect(count('SELECT count(*) AS n FROM credential')).toBe(1);
  });

  it('works up to 30 minutes and is refused after', async () => {
    const { token } = issueSetupToken(t.db, env);
    setNow(NOW + limits.setupTokenMs - 1);
    expect((await new Client(app, env).post('/admin/api/auth/register/options', { code: token })).status).toBe(200);
    setNow(NOW + limits.setupTokenMs);
    expect((await new Client(app, env).post('/admin/api/auth/register/options', { code: token })).text).toBe(CODE_REFUSED);
  });

  it('is refused at verify if it expires between the two steps, and nothing is stored', async () => {
    const { token } = issueSetupToken(t.db, env);
    const client = new Client(app, env);
    const options = await client.post('/admin/api/auth/register/options', { code: token });
    const response = newAuthenticator(env).register(options.json as never);
    setNow(NOW + limits.setupTokenMs);
    const res = await client.post('/admin/api/auth/register/verify', { code: token, name: 'Laptop', response });
    expect(res.text).toBe(CODE_REFUSED);
    expect(count('SELECT count(*) AS n FROM credential')).toBe(0);
    expect(count('SELECT count(*) AS n FROM session')).toBe(0);
  });

  it('lets exactly one of two racing registrations win', async () => {
    const { token } = issueSetupToken(t.db, env);
    const a = new Client(app, env);
    const b = new Client(app, env);
    const [oa, ob] = await Promise.all([a.post('/admin/api/auth/register/options', { code: token }), b.post('/admin/api/auth/register/options', { code: token })]);
    const [ra, rb] = await Promise.all([
      a.post('/admin/api/auth/register/verify', { code: token, name: 'A', response: newAuthenticator(env).register(oa.json as never) }),
      b.post('/admin/api/auth/register/verify', { code: token, name: 'B', response: newAuthenticator(env).register(ob.json as never) }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 400]);
    expect(count('SELECT count(*) AS n FROM credential')).toBe(1);
  });

  it('can be issued again while the server has passkeys: it is how both are recovered (spec §4.3)', async () => {
    await signedIn(app, t.db, env);
    const { token } = issueSetupToken(t.db, env);
    expect((await new Client(app, env).registerWithCode(newAuthenticator(env), token, 'Recovery')).status).toBe(200);
    expect(count('SELECT count(*) AS n FROM credential')).toBe(2);
  });

  it('clears used and expired codes when the next one is issued', () => {
    issueSetupToken(t.db, env);
    setNow(NOW + limits.setupTokenMs + 1);
    issueSetupToken(t.db, env);
    expect(count('SELECT count(*) AS n FROM auth_code')).toBe(1);
  });
});

describe('the enrolment code (AC-20)', () => {
  it('needs a fresh session: REAUTH_REQUIRED at 5:01, and a re-authentication brings it back', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    setNow(NOW + 5 * MINUTE + 1000);
    const refused = await client.post('/admin/api/enrolment-codes');
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({ code: 'REAUTH_REQUIRED' });
    expect(count("SELECT count(*) AS n FROM auth_code WHERE kind = 'enrol'")).toBe(0);
    await client.reauth(auth);
    expect((await client.post('/admin/api/enrolment-codes')).status).toBe(200);
  });

  it('is issued at 4:59 and not at 5:01', async () => {
    const { client } = await signedIn(app, t.db, env);
    setNow(NOW + 5 * MINUTE - 1000);
    expect((await client.post('/admin/api/enrolment-codes')).status).toBe(200);
    setNow(NOW + 5 * MINUTE + 1000);
    expect((await client.post('/admin/api/enrolment-codes')).status).toBe(403);
  });

  it('returns the code as XXXX-XXXX-XXXX in Crockford base32, the link, a QR as an SVG data URL, and the expiry', async () => {
    const { client } = await signedIn(app, t.db, env);
    const res = await client.post('/admin/api/enrolment-codes');
    expect(res.status).toBe(200);
    expect(Object.keys(res.json).sort()).toEqual(['code', 'expiresAt', 'link', 'qr']);
    expect(res.json.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(res.json.link).toBe(`${env.origin}/admin/setup/${res.json.code as string}`);
    expect(res.json.expiresAt).toBe(NOW + limits.enrolmentCodeMs);
    expect(res.json.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from((res.json.qr as string).split(',')[1] ?? '', 'base64').toString('utf8');
    expect(svg).toContain('<svg');
    // The QR carries no script and calls nothing off-site.
    expect(svg).not.toMatch(/<script|xlink:href|<image/);
  });

  it('is stored only as a hash', async () => {
    const { client } = await signedIn(app, t.db, env);
    const code = await enrolmentCode(client);
    expect(JSON.stringify(t.db.prepare('SELECT * FROM auth_code').all())).not.toContain(code.replace(/-/g, ''));
    expect(JSON.stringify(t.db.prepare('SELECT * FROM auth_code').all())).not.toContain(code);
  });

  it('enrols exactly one new passkey within 10 minutes, and signs that device in', async () => {
    const { client } = await signedIn(app, t.db, env);
    const code = await enrolmentCode(client);
    setNow(NOW + limits.enrolmentCodeMs - 1);
    const phone = newAuthenticator(env);
    const device = new Client(app, env);
    const res = await device.registerWithCode(phone, code, 'Phone');
    expect(res.status).toBe(200);
    expect(res.json.deviceCredentialId).toBe(phone.credentialId);
    expect(count('SELECT count(*) AS n FROM credential')).toBe(2);
    expect((await device.get('/admin/api/session')).status).toBe(200);
    // And the code is spent.
    expect((await new Client(app, env).registerWithCode(newAuthenticator(env), code)).text).toBe(CODE_REFUSED);
  });

  it('ends the session the enrolling request arrived with, as a sign-in does (AC-10)', async () => {
    const { client } = await signedIn(app, t.db, env);
    const code = await enrolmentCode(client);
    const before = client.cookie;
    expect((await client.registerWithCode(newAuthenticator(env), code, 'Phone')).status).toBe(200);
    expect(client.cookie).not.toBe(before);
    expect(count('SELECT count(*) AS n FROM session')).toBe(1);
    const stale = new Client(app, env);
    stale.cookie = before;
    expect((await stale.get('/admin/api/session')).status).toBe(401);
  });

  it('is refused after 10 minutes', async () => {
    const { client } = await signedIn(app, t.db, env);
    const code = await enrolmentCode(client);
    setNow(NOW + limits.enrolmentCodeMs);
    expect((await new Client(app, env).registerWithCode(newAuthenticator(env), code)).text).toBe(CODE_REFUSED);
  });

  it('is read the way Crockford says: any case, no hyphens, O for 0', async () => {
    const { client } = await signedIn(app, t.db, env);
    const code = await enrolmentCode(client);
    const typed = code.replace(/-/g, ' ').toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l');
    expect((await new Client(app, env).registerWithCode(newAuthenticator(env), typed)).status).toBe(200);
  });

  it('voids the unused code before it when a new one is issued', async () => {
    const { client } = await signedIn(app, t.db, env);
    const first = await enrolmentCode(client);
    const second = await enrolmentCode(client);
    expect((await new Client(app, env).registerWithCode(newAuthenticator(env), first)).text).toBe(CODE_REFUSED);
    expect((await new Client(app, env).registerWithCode(newAuthenticator(env), second)).status).toBe(200);
  });

  it('is refused to a request whose session was ended, with 401, and issues nothing', async () => {
    const { client } = await signedIn(app, t.db, env);
    t.db.prepare('DELETE FROM session').run();
    expect((await client.post('/admin/api/enrolment-codes')).status).toBe(401);
    expect(count("SELECT count(*) AS n FROM auth_code WHERE kind = 'enrol'")).toBe(0);
  });

  it('is refused by issueEnrolmentCode itself without a fresh session', async () => {
    const { client } = await signedIn(app, t.db, env);
    const session = validateSession(t.db, client.cookie as string);
    if (!session) throw new Error('no session');
    setNow(NOW + 6 * MINUTE);
    expect(issueEnrolmentCode(t.db, env, session)).toBe('REAUTH_REQUIRED');
  });
});

describe('one refusal, one body (AC-20, AC-21)', () => {
  it('answers the same bytes for a used, an expired, an unknown, a malformed and a missing code, at both steps', async () => {
    // Rows are written directly so each state exists at once: issuing a code sweeps the used ones.
    const row = (kind: 'setup' | 'enrol', value: string, usedAt: number | null, expiresAt: number) =>
      t.db.prepare('INSERT INTO auth_code (id, kind, hash, expires_at, used_at) VALUES (?, ?, ?, ?, ?)').run(value, kind, codeHash(value), expiresAt, usedAt);
    const used = 'usedUsedUsedUsedUsed00';
    const expired = 'expiredExpiredExpired0';
    const usedEnrol = 'K7FQ-2MXP-R9TD';
    const expiredEnrol = 'QQQQ-2MXP-R9TD';
    row('setup', used, NOW - 1000, NOW + 10 * MINUTE);
    row('setup', expired, null, NOW - 1);
    row('enrol', usedEnrol, NOW - 1000, NOW + 10 * MINUTE);
    row('enrol', expiredEnrol, null, NOW - 1);

    const candidates: unknown[] = [used, expired, usedEnrol, expiredEnrol, 'unknown-token-aaaaaaaa', 'ABCD-EFGH-JKMN', '', ' ', 'x'.repeat(5000), 42, null, {}, [], true];
    const replies: { status: number; text: string; type: string | null }[] = [];
    for (const code of candidates) {
      for (const path of ['/admin/api/auth/register/options', '/admin/api/auth/register/verify']) {
        // Out of the wait each time, so every reply is the refusal of its own value.
        t.db.prepare('UPDATE auth_throttle SET failures = 0, last_failure_at = NULL').run();
        const res = await new Client(app, env).post(path, { code, name: 'x', response: {} });
        replies.push({ status: res.status, text: res.text, type: res.headers.get('Content-Type') });
      }
    }
    expect(replies.length).toBe(candidates.length * 2);
    for (const r of replies) {
      expect(r.status).toBe(400);
      expect(r.text).toBe(CODE_REFUSED);
      expect(r.type).toBe(replies[0]?.type);
    }
  });

  it('counts every one of those refusals toward back-off (PD-15)', async () => {
    const client = new Client(app, env);
    for (const code of ['a', 'b', 'c']) await client.post('/admin/api/auth/register/options', { code });
    expect((t.db.prepare('SELECT failures FROM auth_throttle').get() as { failures: number }).failures).toBe(3);
  });

  it('answers the same body inside a back-off wait, for a code that would have worked', async () => {
    const client = new Client(app, env);
    const { token } = issueSetupToken(t.db, env);
    t.db.prepare('UPDATE auth_throttle SET failures = 5, last_failure_at = ?').run(NOW);
    const res = await client.post('/admin/api/auth/register/options', { code: token });
    expect(res.text).toBe(CODE_REFUSED);
    // The refusal inside the wait changed nothing.
    expect((t.db.prepare('SELECT failures FROM auth_throttle').get() as { failures: number }).failures).toBe(5);
  });
});

describe('lib/codes.ts directly', () => {
  it('peekCode looks without spending, and redeemCode spends once', () => {
    const { token } = issueSetupToken(t.db, env);
    expect(peekCode(t.db, token)).toMatchObject({ kind: 'setup' });
    expect(peekCode(t.db, token)).toMatchObject({ kind: 'setup' });
    expect(redeemCode(t.db, token)).toMatchObject({ kind: 'setup' });
    expect(redeemCode(t.db, token)).toBe('CODE_REFUSED');
    expect(peekCode(t.db, token)).toBe('CODE_REFUSED');
  });

  it('marks the row used, not deleted, so the used code is refused for what it is', () => {
    const { token } = issueSetupToken(t.db, env);
    redeemCode(t.db, token);
    expect(t.db.prepare('SELECT used_at FROM auth_code').get()).toEqual({ used_at: NOW });
  });

  it('normalises an enrolment code and leaves a setup token alone', () => {
    expect(normaliseCode(' k7fq-2mxp-r9td ')).toBe('K7FQ2MXPR9TD');
    expect(normaliseCode('k7fq 2mxp r9td')).toBe('K7FQ2MXPR9TD');
    expect(normaliseCode('O1IL-0000-0000')).toBe('01110000' + '0000');
    const token = 'aB3-_xYz0123456789AbCd';
    expect(normaliseCode(token)).toBe(token);
  });

  it('refuses a value that is not a string without throwing', () => {
    for (const v of [undefined, null, 1, {}, []]) expect(redeemCode(t.db, v)).toBe('CODE_REFUSED');
  });
});
