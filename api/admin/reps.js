import { initDb, listUsers, listActivity } from '../_lib/db.js';
import { getAuthUser } from '../_lib/auth.js';
import { applyCors } from '../_lib/http.js';

// Admin-only: list all reps with their activity counts + recent activity feed.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  await initDb();

  const users = await listUsers();
  const activity = await listActivity({ limit: 500 });

  // Build per-user counts.
  const counts = new Map();
  for (const a of activity) {
    const c = counts.get(a.user_id) || { searches: 0, pitches: 0, logins: 0, total: 0 };
    if (a.type === 'search') c.searches++;
    else if (a.type === 'generate_pitch') c.pitches++;
    else if (a.type === 'login') c.logins++;
    c.total++;
    counts.set(a.user_id, c);
  }

  const reps = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    created_at: u.created_at,
    stats: counts.get(u.id) || { searches: 0, pitches: 0, logins: 0, total: 0 }
  }));

  res.status(200).json({ reps, recentActivity: activity.slice(0, 100) });
}
