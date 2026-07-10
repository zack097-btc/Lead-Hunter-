import { initDb, getUserByEmail, createUser, logActivity } from '../_lib/db.js';
import { hashPassword, signToken } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

// Self-service signup. New accounts are always created as role "rep".
// The admin account is seeded from environment variables (see _lib/db.js).
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  await initDb();
  const { email, password, name } = readBody(req);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = await getUserByEmail(String(email));
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const password_hash = await hashPassword(String(password));
  const user = await createUser({
    email: String(email),
    name: String(name || '').trim() || String(email).split('@')[0],
    password_hash,
    role: 'rep'
  });

  await logActivity({ user_id: user.id, type: 'register' });

  const token = signToken(user);
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
}
