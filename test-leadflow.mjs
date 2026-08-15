/* Lead status, rep management, and the AI pitch fallback.
 *
 * All three fail in ways that look like success from the outside: a status that
 * doesn't persist, a switched-off rep who can still sign in, or an AI pitch that
 * silently returns nothing. Each is checked against behaviour, not against the
 * absence of an exception. */
import assert from 'node:assert';

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { fails++; console.log('  FAIL ' + name + ' — ' + e.message); }
};

process.env.JWT_SECRET = 'test-secret-long-enough-for-anything-1234567890';
delete process.env.ANTHROPIC_API_KEY;

// ONE canonical db module, shared with the handlers.
//
// Importing with "?v=random" gives a NEW module with a NEW in-memory store,
// which the handlers (which import the plain path) cannot see — so every test
// that created a user and then called a handler was testing an empty database
// and passing or failing for the wrong reason. Tests use unique ids instead of
// a fresh store, which is also closer to how the thing really runs.
const db = await import('./api/_lib/db.js');
await db.initDb();
const auth = await import('./api/_lib/auth.js');
const { default: loginHandler } = await import('./api/auth/login.js');
const { default: meHandler } = await import('./api/auth/me.js');
const { default: repsHandler } = await import('./api/admin/reps.js');
const { default: statusHandler } = await import('./api/leads/status.js');
const { default: pitchHandler } = await import('./api/ai/pitch.js');

let n = 0;
const uniq = (p) => `${p}${++n}_${Date.now()}`;
const mkUser = async (role = 'rep', password = 'abcdef') => {
  const email = uniq('u') + '@x.com';
  const u = await db.createUser({ email, name: 'T' + n, password_hash: await auth.hashPassword(password), role });
  return { ...u, password };
};
const tok = (u) => auth.signToken({ id: u.id, role: u.role, email: u.email, name: u.name });
const res = () => {
  const r = { code: 0, payload: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (p) => { r.payload = p; return r; };
  r.setHeader = () => {}; r.end = () => r;
  return r;
};
const req = (method, body = {}, token = '') =>
  ({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, body, query: {} });

console.log('--- lead status ---');

await check('a status is saved and read back', async () => {
  const id = uniq('node/'), absent = uniq('node/');
  await db.setLeadStatus({ business_id: id, status: 'quoted', note: 'wants 2 vans',
    business_name: 'Acme Plumbing', updated_by: 1 });
  const got = await db.getLeadStatuses([id, absent]);
  assert.equal(got[id].status, 'quoted');
  assert.equal(got[id].note, 'wants 2 vans');
  assert.equal(got[absent], undefined, 'should only return ids that were asked for');
});

await check('re-marking the same lead replaces, it does not duplicate', async () => {
  const id = uniq('node/');
  await db.setLeadStatus({ business_id: id, status: 'contacted', updated_by: 1 });
  await db.setLeadStatus({ business_id: id, status: 'won', updated_by: 1 });
  const mine = (await db.listLeadStatuses({ limit: 500 })).filter((s) => s.business_id === id);
  assert.equal(mine.length, 1, `expected 1 row for that lead, got ${mine.length}`);
  assert.equal(mine[0].status, 'won');
});

await check('a status can be cleared (undoing a mis-tap)', async () => {
  const id = uniq('node/');
  await db.setLeadStatus({ business_id: id, status: 'not_interested', updated_by: 1 });
  await db.clearLeadStatus(id);
  assert.equal((await db.getLeadStatuses([id]))[id], undefined);
});

await check('the endpoint rejects a status that is not one of the four', async () => {
  const u = await mkUser();
  const r = res();
  await statusHandler(req('POST', { business_id: uniq('n/'), status: 'maybe-later' }, tok(u)), r);
  assert.equal(r.code, 400, `expected 400, got ${r.code} ${JSON.stringify(r.payload)}`);
});

await check('an unauthenticated caller cannot set a status', async () => {
  const r = res();
  await statusHandler(req('POST', { business_id: 'n/1', status: 'won' }), r);
  assert.equal(r.code, 401, `expected 401, got ${r.code}`);
});

console.log('\n--- rep management ---');

await check('a switched-off rep cannot sign in', async () => {
  const u = await mkUser('rep', 'correct-horse');
  let r = res();
  await loginHandler(req('POST', { email: u.email, password: 'correct-horse' }), r);
  assert.equal(r.code, 200, `should sign in while active (got ${r.code} ${JSON.stringify(r.payload)})`);

  await db.setUserActive(u.id, false);
  r = res();
  await loginHandler(req('POST', { email: u.email, password: 'correct-horse' }), r);
  assert.equal(r.code, 403, `switched-off rep signed in anyway (got ${r.code})`);
});

await check('a switched-off rep with a VALID TOKEN is still shut out', async () => {
  const u = await mkUser();
  const token = tok(u);
  let r = res();
  await meHandler(req('GET', {}, token), r);
  assert.equal(r.code, 200, 'token should work while active');

  await db.setUserActive(u.id, false);
  r = res();
  await meHandler(req('GET', {}, token), r);
  assert.equal(r.code, 403, `a 30-day token outlived the switch-off (got ${r.code})`);
});

await check('wrong password on a disabled account still says "invalid", not "disabled"', async () => {
  const u = await mkUser('rep', 'right-one');
  await db.setUserActive(u.id, false);
  const r = res();
  await loginHandler(req('POST', { email: u.email, password: 'WRONG' }), r);
  assert.equal(r.code, 401, 'must not reveal that the account exists');
});

await check('an admin cannot switch off their own account', async () => {
  const a = await mkUser('admin');
  const r = res();
  await repsHandler(req('POST', { action: 'disable', userId: a.id }, tok(a)), r);
  assert.equal(r.code, 400, `admin locked themselves out (got ${r.code} ${JSON.stringify(r.payload)})`);
});

await check('an admin CAN switch another rep off and back on', async () => {
  const a = await mkUser('admin');
  const rep = await mkUser('rep');
  let r = res();
  await repsHandler(req('POST', { action: 'disable', userId: rep.id }, tok(a)), r);
  assert.equal(r.code, 200, `disable failed (${r.code})`);
  assert.equal(r.payload.user.active, false);
  r = res();
  await repsHandler(req('POST', { action: 'enable', userId: rep.id }, tok(a)), r);
  assert.equal(r.payload.user.active, true, 'could not switch back on');
});

await check('a rep cannot reach the admin endpoint', async () => {
  const u = await mkUser('rep');
  const r = res();
  await repsHandler(req('GET', {}, tok(u)), r);
  assert.equal(r.code, 403, `a rep got into the admin panel (got ${r.code})`);
});

await check('a token CLAIMING admin is checked against the database', async () => {
  const u = await mkUser('rep');                       // a REP in the database
  // ...but the token says admin. That is the shape of an edited or stolen token.
  const token = auth.signToken({ id: u.id, role: 'admin', email: u.email, name: u.name });
  const r = res();
  await repsHandler(req('GET', {}, token), r);
  assert.equal(r.code, 403, `a token claiming admin was believed (got ${r.code})`);
});

await check('outcomes are counted per rep from the status table', async () => {
  const a = await mkUser('admin');
  const w = uniq('won/'), q = uniq('quote/');
  await db.setLeadStatus({ business_id: w, status: 'won', updated_by: a.id });
  await db.setLeadStatus({ business_id: q, status: 'quoted', updated_by: a.id });
  await db.setLeadStatus({ business_id: q, status: 'quoted', updated_by: a.id });  // re-mark
  const r = res();
  await repsHandler(req('GET', {}, tok(a)), r);
  assert.equal(r.code, 200, `admin GET failed (${r.code})`);
  const boss = r.payload.reps.find((x) => x.id === a.id);
  assert.equal(boss.stats.won, 1, 'wins miscounted');
  assert.equal(boss.stats.quoted, 1, 're-marking the same lead inflated the count');
});

console.log('\n--- pitch: AI optional, template guaranteed ---');

await check('with no API key it still returns usable copy', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const u = await mkUser();
  const r = res();
  await pitchHandler(req('POST', { businessName: 'Acme Plumbing', businessType: 'plumber' }, tok(u)), r);
  assert.equal(r.code, 200);
  assert.equal(r.payload.source, 'template');
  assert.ok(r.payload.email.length > 50, 'email too short to be useful');
  assert.ok(r.payload.pitch.length > 30, 'pitch too short to be useful');
});

await check('when the AI call FAILS the rep still gets a template, not an error', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-not-a-real-key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const u = await mkUser();
    const r = res();
    await pitchHandler(req('POST', { businessName: 'Harbour Marina', businessType: 'marina' }, tok(u)), r);
    assert.equal(r.code, 200, 'a dead AI call must not fail the request');
    assert.equal(r.payload.source, 'template');
    assert.ok(r.payload.pitch.length > 30);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

await check('when the AI answers, its copy is used', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-not-a-real-key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ text: '{"email":"Subject line here\\n\\nBody of the email.","pitch":"Spoken pitch."}' }] })
  });
  try {
    const u = await mkUser();
    const r = res();
    await pitchHandler(req('POST', { businessName: 'Corner Cafe', businessType: 'cafe' }, tok(u)), r);
    assert.equal(r.payload.source, 'ai');
    assert.equal(r.payload.pitch, 'Spoken pitch.');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

await check('malformed AI output falls back rather than shipping junk', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-not-a-real-key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: 'sorry, I cannot do that' }] }) });
  try {
    const u = await mkUser();
    const r = res();
    await pitchHandler(req('POST', { businessName: 'Test', businessType: 'shop' }, tok(u)), r);
    assert.equal(r.payload.source, 'template');
    assert.ok(r.payload.email.length > 50);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL LEAD-FLOW CHECKS PASSED');
process.exit(fails ? 1 : 0);
