// Storage layer with two backends:
//   1. Postgres  - used automatically when POSTGRES_URL / DATABASE_URL is set
//                  (required in production; Vercel functions are stateless).
//   2. In-memory - fallback for quick local testing with `vercel dev`.
//                  Data is NOT persisted across restarts.
import pkg from 'pg';
import { hashPassword } from './auth.js';

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
  } else {
    if (!mem) mem = { users: [], activity: [], userSeq: 1, actSeq: 1 };
    console.warn(
      '[db] No POSTGRES_URL set - using in-memory store. Data will NOT persist. ' +
        'Set POSTGRES_URL in production.'
    );
  }
  await seedAdmin();
}

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@jzacdesigns.com').toLowerCase().trim();
  const existing = await getUserByEmail(email);
  if (existing) return;
  const password = process.env.ADMIN_PASSWORD || 'change-this-now';
  const name = process.env.ADMIN_NAME || 'JZac Admin';
  const password_hash = await hashPassword(password);
  await createUser({ email, name, password_hash, role: 'admin' });
  console.log(`[db] Seeded admin account: ${email}`);
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
    created_at: new Date().toISOString()
  };
  mem.users.push(user);
  return { id: user.id, email, name, role, created_at: user.created_at };
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
    const q = role
      ? [`SELECT id, email, name, role, created_at FROM users WHERE role = $1 ORDER BY id`, [role]]
      : [`SELECT id, email, name, role, created_at FROM users ORDER BY id`, []];
    const { rows } = await getPool().query(q[0], q[1]);
    return rows;
  }
  let list = mem ? mem.users : [];
  if (role) list = list.filter((u) => u.role === role);
  return list.map(({ id, email, name, role, created_at }) => ({ id, email, name, role, created_at }));
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
