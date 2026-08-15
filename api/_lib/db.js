// Storage layer with two backends:
//   1. Postgres  - used automatically when POSTGRES_URL / DATABASE_URL is set
//                  (required in production; Vercel functions are stateless).
//   2. In-memory - fallback for quick local testing with `vercel dev`.
//                  Data is NOT persisted across restarts.
import pkg from 'pg';
import { hashPassword, comparePassword } from './auth.js';

const { Pool } = pkg;
const CONN = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';

let pool = null;
let mem = null; // { users: [], activity: [], userSeq, actSeq }
let initPromise = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: CONN,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

export function initDb() {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit() {
  if (CONN) {
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'rep',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS activity (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        business_name TEXT DEFAULT '',
        business_address TEXT DEFAULT '',
        detail JSONB,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id);`);
    // Overpass is a free, shared and frequently slow service. Caching its raw
    // answers is the single biggest speed win available: a second search in an
    // area somebody already covered returns instantly instead of waiting on it.
    // The RAW elements are stored, not the finished lead list, so distance and
    // ranking are still computed fresh for wherever the rep is standing.
    await p.query(`
      CREATE TABLE IF NOT EXISTS lead_cache (
        cache_key TEXT PRIMARY KEY,
        elements JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_lead_cache_age ON lead_cache(created_at);`);

    // ---- lead status ------------------------------------------------------
    // Without this the app is a directory, not a sales tool: every search
    // hands a rep the same doors they knocked on last week, and nobody can
    // tell what came of any of it. Keyed by the OpenStreetMap id, which is
    // stable, so a lead keeps its history across searches and across reps.
    //
    // Status is shared across the team on purpose. Two reps working the same
    // street should not both walk into a business that already said no.
    await p.query(`
      CREATE TABLE IF NOT EXISTS lead_status (
        business_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        business_name TEXT NOT NULL DEFAULT '',
        business_address TEXT NOT NULL DEFAULT '',
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        updated_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_lead_status_updated ON lead_status(updated_at DESC);`);

    // ---- columns added after the first release ----------------------------
    // ALTER ... IF NOT EXISTS so an existing database upgrades itself on the
    // next deploy rather than needing anyone to run SQL by hand.
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;`);
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;`);
  } else {
    if (!mem) mem = { users: [], activity: [], leadStatus: new Map(), userSeq: 1, actSeq: 1 };
    if (!mem.leadStatus) mem.leadStatus = new Map();
    console.warn(
      '[db] No POSTGRES_URL set - using in-memory store. Data will NOT persist. ' +
        'Set POSTGRES_URL in production.'
    );
  }
  await seedAdmin();
}

export async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = process.env.ADMIN_NAME || 'JZac Admin';

  // No default password, ever. The previous version fell back to the string
  // 'change-this-now', which is published in .env.example in a PUBLIC repo - so
  // on a public URL that was an open admin account for anyone who read the
  // repository. An app with no admin is a nuisance; an app with a world-readable
  // admin is a breach. If these are not configured, no admin exists.
  if (!email || !password) {
    console.warn(
      '[db] No admin seeded: set ADMIN_EMAIL and ADMIN_PASSWORD in the environment. ' +
        'Refusing to create an admin with a default password.'
    );
    return;
  }

  const existing = await getUserByEmail(email);

  // The environment is the single source of truth for the admin credential.
  //
  // The old code returned early when the account already existed, which meant
  // that once an admin had been seeded its password could never be changed -
  // there is no password-reset flow in this app, so that was a one-way door.
  // Now, changing ADMIN_PASSWORD in the hosting environment and redeploying is
  // the recovery path, and it also PROMOTES an existing account: register on
  // your phone like anybody else, then put that email in ADMIN_EMAIL and the
  // account becomes the admin, keeping its history.
  if (existing) {
    const same = await comparePassword(password, existing.password_hash).catch(() => false);
    if (same && existing.role === 'admin') return; // already correct, nothing to do
    const password_hash = same ? existing.password_hash : await hashPassword(password);
    await setUserAdmin(existing.id, password_hash);
    console.log(`[db] Admin account updated from the environment: ${email}`);
    return;
  }

  const password_hash = await hashPassword(password);
  await createUser({ email, name, password_hash, role: 'admin' });
  console.log(`[db] Seeded admin account: ${email}`);
}

// Promote a user to admin and set their password hash. Used only by the seeder.
async function setUserAdmin(id, password_hash) {
  if (CONN) {
    await getPool().query(`UPDATE users SET role = 'admin', password_hash = $2 WHERE id = $1`, [
      id,
      password_hash
    ]);
    return;
  }
  const u = mem && mem.users.find((x) => x.id === Number(id));
  if (u) { u.role = 'admin'; u.password_hash = password_hash; }
}

// ---------------------------------------------------------------- users

export async function createUser({ email, name, password_hash, role = 'rep' }) {
  email = email.toLowerCase().trim();
  if (CONN) {
    const { rows } = await getPool().query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at`,
      [email, name, password_hash, role]
    );
    return rows[0];
  }
  const user = {
    id: mem.userSeq++,
    email,
    name,
    password_hash,
    role,
    active: true,
    last_seen: null,
    created_at: new Date().toISOString()
  };
  mem.users.push(user);
  return { id: user.id, email, name, role, active: true, created_at: user.created_at };
}

export async function getUserByEmail(email) {
  email = email.toLowerCase().trim();
  if (CONN) {
    const { rows } = await getPool().query(`SELECT * FROM users WHERE email = $1`, [email]);
    return rows[0] || null;
  }
  return (mem && mem.users.find((u) => u.email === email)) || null;
}

export async function getUserById(id) {
  if (CONN) {
    const { rows } = await getPool().query(`SELECT * FROM users WHERE id = $1`, [id]);
    return rows[0] || null;
  }
  return (mem && mem.users.find((u) => u.id === Number(id))) || null;
}

export async function listUsers(role) {
  if (CONN) {
    const cols = `id, email, name, role, created_at, active, last_seen`;
    const q = role
      ? [`SELECT ${cols} FROM users WHERE role = $1 ORDER BY id`, [role]]
      : [`SELECT ${cols} FROM users ORDER BY id`, []];
    const { rows } = await getPool().query(q[0], q[1]);
    return rows;
  }
  let list = mem ? mem.users : [];
  if (role) list = list.filter((u) => u.role === role);
  return list.map(({ id, email, name, role, created_at, active, last_seen }) =>
    ({ id, email, name, role, created_at, active: active !== false, last_seen: last_seen || null }));
}

// ----------------------------------------------------------- lead cache
//
// OpenStreetMap moves slowly - a plumber does not relocate this week - so a
// week-old answer is as good as a fresh one and hugely faster. `force` on the
// request bypasses this when somebody genuinely wants to re-look.

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memCache = new Map(); // survives within a warm serverless instance

export async function getCachedElements(key) {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.elements;
  if (!CONN) return null;
  try {
    const { rows } = await getPool().query(
      `SELECT elements, created_at FROM lead_cache WHERE cache_key = $1`,
      [key]
    );
    if (!rows[0]) return null;
    if (Date.now() - new Date(rows[0].created_at).getTime() > CACHE_TTL_MS) return null;
    memCache.set(key, { at: Date.now(), elements: rows[0].elements });
    return rows[0].elements;
  } catch {
    return null; // a cache that errors must never break a search
  }
}

export async function putCachedElements(key, elements) {
  memCache.set(key, { at: Date.now(), elements });
  if (memCache.size > 40) memCache.delete(memCache.keys().next().value);
  if (!CONN) return;
  try {
    await getPool().query(
      `INSERT INTO lead_cache (cache_key, elements, created_at)
       VALUES ($1, $2, now())
       ON CONFLICT (cache_key) DO UPDATE SET elements = EXCLUDED.elements, created_at = now()`,
      [key, JSON.stringify(elements)]
    );
  } catch {
    /* caching is an optimisation, never a requirement */
  }
}

// ---------------------------------------------------------- lead status
//
// The set of statuses is deliberately short. A rep standing on a pavement in
// the rain will use four buttons; they will not use eleven.

export const LEAD_STATUSES = ['contacted', 'quoted', 'won', 'not_interested'];

export async function setLeadStatus({ business_id, status, note = '', business_name = '',
                                      business_address = '', lat = null, lng = null, updated_by }) {
  const row = {
    business_id: String(business_id), status: String(status), note: String(note || ''),
    business_name, business_address, lat, lng, updated_by, updated_at: new Date().toISOString()
  };
  if (CONN) {
    const { rows } = await getPool().query(
      `INSERT INTO lead_status (business_id, status, note, business_name, business_address, lat, lng, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (business_id) DO UPDATE SET
         status = EXCLUDED.status, note = EXCLUDED.note,
         business_name = EXCLUDED.business_name, business_address = EXCLUDED.business_address,
         lat = EXCLUDED.lat, lng = EXCLUDED.lng,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [row.business_id, row.status, row.note, business_name, business_address, lat, lng, updated_by]
    );
    return rows[0];
  }
  mem.leadStatus.set(row.business_id, row);
  return row;
}

export async function clearLeadStatus(business_id) {
  if (CONN) { await getPool().query(`DELETE FROM lead_status WHERE business_id = $1`, [String(business_id)]); return; }
  mem.leadStatus.delete(String(business_id));
}

// Only the ids we are about to show are looked up, so this stays fast however
// many leads the team has worked over the years.
export async function getLeadStatuses(ids = []) {
  const out = {};
  if (!ids.length) return out;
  if (CONN) {
    const { rows } = await getPool().query(
      `SELECT ls.*, u.name AS updated_by_name
         FROM lead_status ls LEFT JOIN users u ON u.id = ls.updated_by
        WHERE ls.business_id = ANY($1)`, [ids.map(String)]);
    for (const r of rows) out[r.business_id] = r;
    return out;
  }
  const byId = new Map((mem?.users || []).map((u) => [u.id, u]));
  for (const id of ids.map(String)) {
    const r = mem?.leadStatus?.get(id);
    if (r) out[id] = { ...r, updated_by_name: byId.get(r.updated_by)?.name || '' };
  }
  return out;
}

export async function listLeadStatuses({ limit = 200 } = {}) {
  if (CONN) {
    const { rows } = await getPool().query(
      `SELECT ls.*, u.name AS updated_by_name
         FROM lead_status ls LEFT JOIN users u ON u.id = ls.updated_by
        ORDER BY ls.updated_at DESC LIMIT $1`, [limit]);
    return rows;
  }
  const byId = new Map((mem?.users || []).map((u) => [u.id, u]));
  return [...(mem?.leadStatus?.values() || [])]
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({ ...r, updated_by_name: byId.get(r.updated_by)?.name || '' }));
}

// ------------------------------------------------------- rep management

export async function setUserActive(id, active) {
  if (CONN) {
    const { rows } = await getPool().query(
      `UPDATE users SET active = $2 WHERE id = $1 RETURNING id, email, name, role, active`, [id, !!active]);
    return rows[0] || null;
  }
  const u = mem?.users.find((x) => x.id === Number(id));
  if (!u) return null;
  u.active = !!active;
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active };
}

export async function setUserPassword(id, password_hash) {
  if (CONN) {
    const { rows } = await getPool().query(
      `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, email, name, role`, [id, password_hash]);
    return rows[0] || null;
  }
  const u = mem?.users.find((x) => x.id === Number(id));
  if (!u) return null;
  u.password_hash = password_hash;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

// Best-effort: a failure here must never block a sign-in.
export async function touchLastSeen(id) {
  try {
    if (CONN) { await getPool().query(`UPDATE users SET last_seen = now() WHERE id = $1`, [id]); return; }
    const u = mem?.users.find((x) => x.id === Number(id));
    if (u) u.last_seen = new Date().toISOString();
  } catch { /* ignore */ }
}

// ------------------------------------------------------------- activity

export async function logActivity(entry) {
  const {
    user_id,
    type,
    business_name = '',
    business_address = '',
    detail = null,
    lat = null,
    lng = null
  } = entry;
  if (CONN) {
    await getPool().query(
      `INSERT INTO activity (user_id, type, business_name, business_address, detail, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user_id, type, business_name, business_address, detail ? JSON.stringify(detail) : null, lat, lng]
    );
    return;
  }
  mem.activity.push({
    id: mem.actSeq++,
    user_id: Number(user_id),
    type,
    business_name,
    business_address,
    detail,
    lat,
    lng,
    created_at: new Date().toISOString()
  });
}

// Returns activity joined with the rep's name/email.
export async function listActivity({ userId = null, limit = 100 } = {}) {
  if (CONN) {
    const params = [];
    let where = '';
    if (userId) {
      params.push(userId);
      where = `WHERE a.user_id = $1`;
    }
    params.push(limit);
    const { rows } = await getPool().query(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
         FROM activity a JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT $${params.length}`,
      params
    );
    return rows;
  }
  if (!mem) return [];
  const byId = new Map(mem.users.map((u) => [u.id, u]));
  let rows = [...mem.activity].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (userId) rows = rows.filter((r) => r.user_id === Number(userId));
  return rows.slice(0, limit).map((r) => ({
    ...r,
    user_name: byId.get(r.user_id)?.name || '',
    user_email: byId.get(r.user_id)?.email || ''
  }));
}
