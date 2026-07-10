import { initDb, getUserById } from '../_lib/db.js';
import { getAuthUser } from '../_lib/auth.js';
import { applyCors } from '../_lib/http.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  await initDb();
  const user = await getUserById(auth.uid);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });

  res.status(200).json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
}
