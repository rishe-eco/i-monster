// The test-only clock route exists only with E2E_CLOCK=1, and the server refuses
// to boot in production with it (plan B1; root-app's ANTHROPIC_E2E_STUB precedent).
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { now, resetClock } from '../../lib/clock.ts';
import { NOW, tempDb, testApp } from '../helpers.ts';

const t = tempDb();
afterAll(() => t.cleanup());
afterEach(resetClock);

const post = (app: ReturnType<typeof testApp>, body: unknown) =>
  app.request('/__test/clock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /__test/clock with E2E_CLOCK=1', () => {
  const app = testApp(t.db, { E2E_CLOCK: '1' });

  it('fixes the clock', async () => {
    const res = await post(app, { now: NOW });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ now: NOW });
    expect(now()).toBe(NOW);
  });

  it('lets it run again with null', async () => {
    await post(app, { now: NOW });
    const res = await post(app, { now: null });
    expect(res.status).toBe(200);
    expect(now()).not.toBe(NOW);
  });

  it.each([{}, { now: 'tomorrow' }, { now: 1.5 }, { now: '1' }, [], 'x'])('refuses %j with a code', async (body) => {
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'CLOCK_INVALID' });
    expect(now()).not.toBe(NOW);
  });

  it('refuses a body that is not JSON', async () => {
    const res = await app.request('/__test/clock', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'CLOCK_INVALID' });
  });
});

describe('without E2E_CLOCK', () => {
  const app = testApp(t.db);

  it('has no clock route: it is the 404 page', async () => {
    const res = await post(app, { now: NOW });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Something ate this page.');
    expect(now()).not.toBe(NOW);
  });

  it('has none under any /__test path', async () => {
    expect((await app.request('/__test/anything')).status).toBe(404);
  });
});
