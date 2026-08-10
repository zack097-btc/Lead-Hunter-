/* The admin seeder and the invite gate, against the in-memory store.
 *
 * These two are worth real tests because both fail SILENTLY and both are
 * security-relevant: an admin that quietly isn't created, or an invite gate
 * that quietly isn't enforcing, look identical to a working system until
 * somebody who shouldn't have an account has one. */
import assert from 'node:assert';

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { fails++; console.log('  FAIL ' + name + ' — ' + e.message); }
};

// Fresh module per scenario: initDb() memoises, and the seeder reads env once.
async function freshDb(env = {}) {
  for (const k of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_NAME']) delete process.env[k];
  Object.assign(process.env, env);
  const mod = await import('./api/_lib/db.js?v=' + Math.random());
  await mod.initDb();
  return mod;
}

console.log('--- admin seeding ---');

await check('no ADMIN_PASSWORD ⇒ NO admin is created (the old default was public)', async () => {
  const db = await freshDb({ ADMIN_EMAIL: 'boss@jzacdesigns.com' });
  assert.equal(await db.getUserByEmail('boss@jzacdesigns.com'), null);
  assert.equal(await db.getUserByEmail('admin@jzacdesigns.com'), null);
});

await check('the old default password no longer creates anything', async () => {
  const db = await freshDb({});
  const all = await db.listUsers();
  assert.equal(all.length, 0, `expected no users, got ${all.length}`);
});

await check('email + password ⇒ admin created', async () => {
  const db = await freshDb({ ADMIN_EMAIL: 'boss@jzacdesigns.com', ADMIN_PASSWORD: 'a-real-one-1' });
  const u = await db.getUserByEmail('boss@jzacdesigns.com');
  assert.ok(u, 'admin was not created');
  assert.equal(u.role, 'admin');
});

await check('an existing REP at the admin address is PROMOTED, keeping its id', async () => {
  // Same store, seeded twice — this is the branch Zack actually depends on if
  // he registered on his phone before being made admin.
  const db = await freshDb({ ADMIN_EMAIL: 'zack@jzacdesigns.com', ADMIN_PASSWORD: 'first-pass-1' });
  const { hashPassword, comparePassword } = await import('./api/_lib/auth.js');
  const rep = await db.createUser({
    email: 'phone@jzacdesigns.com', name: 'Zack',
    password_hash: await hashPassword('phone-pass'), role: 'rep'
  });
  assert.equal(rep.role, 'rep');

  process.env.ADMIN_EMAIL = 'phone@jzacdesigns.com';
  process.env.ADMIN_PASSWORD = 'made-admin-999';
  await db.seedAdmin();                       // <- the UPDATE branch, same store

  const after = await db.getUserByEmail('phone@jzacdesigns.com');
  assert.equal(after.id, rep.id, 'promotion must keep the same account, not make a second one');
  assert.equal(after.role, 'admin', 'account was not promoted');
  assert.ok(await comparePassword('made-admin-999', after.password_hash), 'password was not set');
  const admins = (await db.listUsers('admin')).filter((u) => u.email === 'phone@jzacdesigns.com');
  assert.equal(admins.length, 1, 'promotion created a duplicate account');
});

await check('changing ADMIN_PASSWORD on the SAME store really changes it', async () => {
  const { comparePassword } = await import('./api/_lib/auth.js');
  const db = await freshDb({ ADMIN_EMAIL: 'boss@jzacdesigns.com', ADMIN_PASSWORD: 'old-pass-111' });
  const first = await db.getUserByEmail('boss@jzacdesigns.com');
  assert.ok(await comparePassword('old-pass-111', first.password_hash), 'first password not set');

  process.env.ADMIN_PASSWORD = 'brand-new-pass-222';
  await db.seedAdmin();                       // <- the UPDATE branch, same store

  const again = await db.getUserByEmail('boss@jzacdesigns.com');
  assert.equal(again.id, first.id, 'should update in place, not create a second admin');
  assert.ok(await comparePassword('brand-new-pass-222', again.password_hash), 'password was NOT updated');
  assert.ok(!(await comparePassword('old-pass-111', again.password_hash)), 'old password still works');
});

console.log('\n--- invite gate ---');

function fakeReq(body) {
  return { method: 'POST', headers: {}, body };
}
function fakeRes() {
  const r = { code: 0, payload: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (p) => { r.payload = p; return r; };
  r.setHeader = () => {};
  r.end = () => r;
  return r;
}

await check('wrong code is rejected with 403', async () => {
  process.env.INVITE_CODE = 'JZAC-2026';
  const { default: register } = await import('./api/auth/register.js?v=' + Math.random());
  const res = fakeRes();
  await register(fakeReq({ email: 'x@y.com', password: 'abcdef', invite: 'nope' }), res);
  assert.equal(res.code, 403, `expected 403, got ${res.code}`);
});

await check('missing code is rejected when a code is configured', async () => {
  process.env.INVITE_CODE = 'JZAC-2026';
  const { default: register } = await import('./api/auth/register.js?v=' + Math.random());
  const res = fakeRes();
  await register(fakeReq({ email: 'x@y.com', password: 'abcdef' }), res);
  assert.equal(res.code, 403, `expected 403, got ${res.code}`);
});

await check('correct code is accepted', async () => {
  process.env.INVITE_CODE = 'JZAC-2026';
  const { default: register } = await import('./api/auth/register.js?v=' + Math.random());
  const res = fakeRes();
  await register(fakeReq({ email: 'new@y.com', password: 'abcdef', invite: ' JZAC-2026 ' }), res);
  assert.equal(res.code, 201, `expected 201, got ${res.code} ${JSON.stringify(res.payload)}`);
  assert.equal(res.payload.user.role, 'rep', 'signup must never mint an admin');
});

await check('no INVITE_CODE configured ⇒ signup still works (no lockout)', async () => {
  delete process.env.INVITE_CODE;
  const { default: register } = await import('./api/auth/register.js?v=' + Math.random());
  const res = fakeRes();
  await register(fakeReq({ email: 'open@y.com', password: 'abcdef' }), res);
  assert.equal(res.code, 201, `expected 201, got ${res.code}`);
});

console.log('\n--- fail closed without JWT_SECRET ---');

await check('a deployed instance with no JWT_SECRET refuses to verify tokens', async () => {
  delete process.env.JWT_SECRET;
  process.env.POSTGRES_URL = 'postgres://looks-deployed';   // marks it as deployed
  const auth = await import('./api/_lib/auth.js?v=' + Math.random());
  delete process.env.POSTGRES_URL;
  assert.equal(auth.SECRET_MISSING, true, 'should have detected the missing secret');
  // the old published fallback must not validate anything
  const jwt = (await import('jsonwebtoken')).default;
  const forged = jwt.sign({ uid: 1, role: 'admin' }, 'dev-insecure-secret-change-me');
  assert.equal(auth.verifyToken(forged), null, 'a token forged with the OLD PUBLIC secret was accepted');
  assert.equal(auth.getAuthUser({ headers: { authorization: 'Bearer ' + forged } }), null,
    'getAuthUser accepted a forged admin token');
});

await check('with a real JWT_SECRET, normal tokens still work', async () => {
  process.env.JWT_SECRET = 'a-genuinely-long-random-secret-value-123456';
  const auth = await import('./api/_lib/auth.js?v=' + Math.random());
  assert.equal(auth.SECRET_MISSING, false);
  const t = auth.signToken({ id: 7, role: 'admin', email: 'z@x.com', name: 'Zack' });
  const back = auth.verifyToken(t);
  assert.equal(back.uid, 7);
  assert.equal(back.role, 'admin');
  const jwt = (await import('jsonwebtoken')).default;
  const forged = jwt.sign({ uid: 1, role: 'admin' }, 'dev-insecure-secret-change-me');
  assert.equal(auth.verifyToken(forged), null, 'forged token accepted despite a real secret');
});

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL AUTH CHECKS PASSED');
process.exit(fails ? 1 : 0);
