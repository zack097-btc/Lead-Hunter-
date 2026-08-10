import { initDb, getUserByEmail, logActivity } from '../_lib/db.js';
import { comparePassword, signToken, SECRET_MISSING, SECRET_MISSING_MESSAGE } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Fail closed with an explanation rather than a stack trace.
  if (SECRET_MISSING) return res.status(503).json({ error: SECRET_MISSING_MESSAGE });

  await initDb();
  const { email, password } = readBody(req);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = await getUserByEmail(String(email));
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await comparePassword(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  await logActivity({ user_id: user.id, type: 'login' });

  const token = signToken(user);
  res.status(200).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
}
