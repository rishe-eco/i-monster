// Listing and removing passkeys, and what removing one does to sessions
// (AC-22, AC-23, AC-45; PD-13), and the independence note's stored state (AC-24).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
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

const sessionCount = () => (t.db.prepare('SELECT count(*) AS n FROM session').get() as { n: number }).n;
const credentialCount = () => (t.db.prepare('SELECT count(*) AS n FROM credential').get() as { n: number }).n;

/** Two devices, each with a passkey and its own signed-in browser. The phone was enrolled by a code from the laptop. */
async function twoDevices() {
  const laptop = await signedIn(app, t.db, env);
  const code = await enrolmentCode(laptop.client);
  // A minute apart, so the list's order (by date added) is the order they were made in.
  setNow(NOW + MINUTE);
  const phone = { client: new Client(app, env), auth: newAuthenticator(env) };
  expect((await phone.client.registerWithCode(phone.auth, code, 'Phone')).status).toBe(200);
  return { laptop, phone };
}

describe('GET /admin/api/passkeys (AC-22)', () => {
  it('lists each passkey with its name, the date it was added and whether it is this device, and nothing else', async () => {
    const { laptop, phone } = await twoDevices();
    const res = await laptop.client.get('/admin/api/passkeys');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      passkeys: [
        { id: laptop.auth.credentialId, name: 'Laptop', addedAt: NOW, thisDevice: true },
        { id: phone.auth.credentialId, name: 'Phone', addedAt: NOW + MINUTE, thisDevice: false },
      ],
    });
    const seen = await phone.client.get('/admin/api/passkeys');
    expect((seen.json.passkeys as { id: string; thisDevice: boolean }[]).map((p) => [p.id, p.thisDevice])).toEqual([
      [laptop.auth.credentialId, false],
      [phone.auth.credentialId, true],
    ]);
  });

  it('carries no last-used time, count or total (W7, house rule 1)', async () => {
    const { laptop } = await twoDevices();
    const res = await laptop.client.get('/admin/api/passkeys');
    for (const p of res.json.passkeys as Record<string, unknown>[]) {
      expect(Object.keys(p).sort()).toEqual(['addedAt', 'id', 'name', 'thisDevice']);
    }
    expect(Object.keys(res.json)).toEqual(['passkeys']);
  });

  it('does not show a passkey\'s key, sign count or backup flags', async () => {
    const { laptop } = await twoDevices();
    const text = (await laptop.client.get('/admin/api/passkeys')).text;
    expect(text).not.toMatch(/public|sign_?count|backup|aaguid|transport/i);
  });
});

describe('DELETE /admin/api/passkeys/:id', () => {
  it('needs a fresh session: REAUTH_REQUIRED at 5:01, and nothing is removed', async () => {
    const { laptop, phone } = await twoDevices();
    setNow(NOW + 5 * MINUTE + 1000);
    const res = await laptop.client.delete(`/admin/api/passkeys/${phone.auth.credentialId}`);
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ code: 'REAUTH_REQUIRED' });
    expect(credentialCount()).toBe(2);
  });

  it('removes a passkey after a re-authentication (AC-11)', async () => {
    const { laptop, phone } = await twoDevices();
    setNow(NOW + 6 * MINUTE);
    await laptop.client.reauth(laptop.auth);
    const res = await laptop.client.delete(`/admin/api/passkeys/${phone.auth.credentialId}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ signedOut: false });
    expect(credentialCount()).toBe(1);
  });

  it('is allowed at 4:59 after the sign-in', async () => {
    const { laptop, phone } = await twoDevices();
    setNow(NOW + 5 * MINUTE - 1000);
    expect((await laptop.client.delete(`/admin/api/passkeys/${phone.auth.credentialId}`)).status).toBe(200);
  });

  it('answers NOT_FOUND for a passkey that does not exist', async () => {
    const { laptop } = await twoDevices();
    const res = await laptop.client.delete('/admin/api/passkeys/no-such-credential');
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ code: 'NOT_FOUND' });
  });

  it('refuses the last passkey: LAST_PASSKEY, and it stays (AC-23)', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    const res = await client.delete(`/admin/api/passkeys/${auth.credentialId}`);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ code: 'LAST_PASSKEY' });
    expect(credentialCount()).toBe(1);
    expect((await client.get('/admin/api/session')).status).toBe(200);
  });

  it('refuses the last passkey even after the others are gone, whichever is left', async () => {
    const { laptop, phone } = await twoDevices();
    expect((await laptop.client.delete(`/admin/api/passkeys/${phone.auth.credentialId}`)).status).toBe(200);
    const res = await laptop.client.delete(`/admin/api/passkeys/${laptop.auth.credentialId}`);
    expect(res.json).toEqual({ code: 'LAST_PASSKEY' });
  });

  it('is checked in the order fresh, found, last: an unfresh request learns nothing about which ids exist', async () => {
    const { client } = await signedIn(app, t.db, env);
    setNow(NOW + 6 * MINUTE);
    const unknown = await client.delete('/admin/api/passkeys/nope');
    expect(unknown.json).toEqual({ code: 'REAUTH_REQUIRED' });
  });
});

describe('AC-22: removing a passkey ends every session it opened', () => {
  it('gives 401 to the next request of a session that passkey opened, and leaves the others', async () => {
    const { laptop, phone } = await twoDevices();
    // A second laptop browser, signed in with the same passkey: also opened by it.
    const laptop2 = new Client(app, env);
    expect((await laptop2.signIn(laptop.auth)).status).toBe(200);
    expect(sessionCount()).toBe(3);

    const res = await phone.client.delete(`/admin/api/passkeys/${laptop.auth.credentialId}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ signedOut: false });

    expect((await laptop.client.get('/admin/api/session')).status).toBe(401);
    expect((await laptop2.get('/admin/api/session')).status).toBe(401);
    expect((await phone.client.get('/admin/api/session')).status).toBe(200);
    expect(sessionCount()).toBe(1);
  });

  it('does not let the removed passkey sign in again', async () => {
    const { laptop, phone } = await twoDevices();
    await phone.client.delete(`/admin/api/passkeys/${laptop.auth.credentialId}`);
    expect((await new Client(app, env).signIn(laptop.auth)).json).toEqual({ code: 'SIGNIN_FAILED' });
  });

  it('is done by the foreign key, proven by direct SQL: deleting the row removes the sessions it opened and the ones it marks as device', () => {
    const insertCredential = (id: string) =>
      t.db.prepare("INSERT INTO credential (id, public_key, name, created_at) VALUES (?, x'00', ?, ?)").run(id, id, NOW);
    const insertSession = (hash: string, openedBy: string, device: string) =>
      t.db
        .prepare('INSERT INTO session (id_hash, opened_by, device_credential, csrf, created_at, last_seen_at, auth_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(hash, openedBy, device, 'c', NOW, NOW, NOW);
    insertCredential('A');
    insertCredential('B');
    insertSession('opened-by-A', 'A', 'A');
    insertSession('opened-by-B-device-A', 'B', 'A');
    insertSession('opened-by-B', 'B', 'B');
    t.db.prepare("DELETE FROM credential WHERE id = 'A'").run();
    const left = t.db.prepare('SELECT id_hash FROM session ORDER BY id_hash').all();
    expect(left).toEqual([{ id_hash: 'opened-by-B' }]);
  });
});

describe('AC-45: removing this device\'s own passkey', () => {
  it('signs this device out, answers signedOut and clears the cookie, and the next request gets 401', async () => {
    const { laptop, phone } = await twoDevices();
    const res = await phone.client.delete(`/admin/api/passkeys/${phone.auth.credentialId}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ signedOut: true });
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=0/i);
    expect(phone.client.cookie).toBeNull();
    expect((await phone.client.get('/admin/api/session')).status).toBe(401);
    // The other device carries on.
    expect((await laptop.client.get('/admin/api/session')).status).toBe(200);
    expect(credentialCount()).toBe(1);
  });

  it('shows Remove for it only when another passkey exists: the last is refused first (AC-23)', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    expect((await client.delete(`/admin/api/passkeys/${auth.credentialId}`)).json).toEqual({ code: 'LAST_PASSKEY' });
  });

  it('keys "this device" on device_credential and revocation on opened_by (PD-13)', async () => {
    // Cross-device sign-in: the laptop's passkey opened the session on a new device,
    // then the new device added its own passkey, which is now "this device".
    const laptop = await signedIn(app, t.db, env);
    const newDevice = new Client(app, env);
    expect((await newDevice.signIn(laptop.auth)).status).toBe(200);
    const own = newAuthenticator(env);
    expect((await newDevice.registerFromSession(own, 'New device')).status).toBe(200);
    const row = t.db.prepare('SELECT opened_by, device_credential FROM session WHERE opened_by = ? AND device_credential = ?').get(laptop.auth.credentialId, own.credentialId);
    expect(row).toBeTruthy();

    // Removing the new device's own passkey signs the new device out, but not the laptop.
    const res = await newDevice.delete(`/admin/api/passkeys/${own.credentialId}`);
    expect(res.json).toEqual({ signedOut: true });
    expect((await newDevice.get('/admin/api/session')).status).toBe(401);
    expect((await laptop.client.get('/admin/api/session')).status).toBe(200);
  });

  it('signs the new device out too when the passkey that opened its session is removed (opened_by)', async () => {
    const laptop = await signedIn(app, t.db, env);
    const newDevice = new Client(app, env);
    await newDevice.signIn(laptop.auth);
    const own = newAuthenticator(env);
    await newDevice.registerFromSession(own, 'New device');
    // The new device removes the laptop's passkey: its own session was opened by it.
    const res = await newDevice.delete(`/admin/api/passkeys/${laptop.auth.credentialId}`);
    expect(res.json).toEqual({ signedOut: true });
    expect((await newDevice.get('/admin/api/session')).status).toBe(401);
  });
});

describe('the independence note (AC-24)', () => {
  it('is stored as not dismissed, and dismissing it is kept', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    expect((await client.get('/admin/api/session')).json.independenceNoteDismissed).toBe(false);
    const res = await client.post('/admin/api/settings/independence-note/dismiss');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ independenceNoteDismissed: true });
    expect((await client.get('/admin/api/session')).json.independenceNoteDismissed).toBe(true);
    // And for a new session, on another device: it is the site's state, not the session's.
    const again = new Client(app, env);
    expect((await again.signIn(auth)).json.independenceNoteDismissed).toBe(true);
  });

  it('can be dismissed twice', async () => {
    const { client } = await signedIn(app, t.db, env);
    expect((await client.post('/admin/api/settings/independence-note/dismiss')).status).toBe(200);
    expect((await client.post('/admin/api/settings/independence-note/dismiss')).status).toBe(200);
  });
});
