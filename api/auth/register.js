import { initDb, getUserByEmail, createUser, logActivity } from '../_lib/db.js';
import { hashPassword, signToken } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

// Self-service signup. New accounts are always created as role "rep".
// The admin account is seeded from environment variables (see _lib/db.js).
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  await initDb();
  const { email, password, name, invite } = readBody(req);

  // Invite gate. This app sits on a public URL, so without this anybody who
  // finds it can create an account and use it. When INVITE_CODE is set in the
  // environment a new account needs it; when it is not set, signup stays open
  // and says so in the log. Deliberately that way round and not the reverse:
  // a gate that defaults to ON with no code configured would lock the owner out
  // of his own app on the next deploy.
  const required = (process.env.INVITE_CODE || '').trim();
  if (required) {
    if (String(invite || '').trim() !== required)
      return res
        .status(403)
        .json({ error: 'That invite code is not right. Ask Zack for the current one.' });
  } else {
    console.warn('[auth] INVITE_CODE is not set — anyone who finds this URL can register.');
  }

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
