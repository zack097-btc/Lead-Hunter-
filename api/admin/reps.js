import {
  initDb, listUsers, listActivity, listLeadStatuses,
  setUserActive, setUserPassword, getUserById
} from '../_lib/db.js';
import { getAuthUser, hashPassword } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

// -----------------------------------------------------------------------------
// Admin only.
//
// GET   the team: every account, what they have done, and what came of it.
// POST  act on one rep: switch off, switch on, or set a new password.
//
// The GET reports OUTCOMES as well as effort. Counting searches tells you who
// is busy; counting quotes and wins tells you who is selling, and those are not
// reliably the same person.
// -----------------------------------------------------------------------------

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  await initDb();

  // The token says admin, but that token may be thirty days old. Confirm
  // against the database, so an admin who has since been switched off cannot
  // carry on administering.
  const me = await getUserById(auth.uid);
  if (!me || me.role !== 'admin' || me.active === false)
    return res.status(403).json({ error: 'Admin access required' });

  // ---------------------------------------------------------------- actions
  if (req.method === 'POST') {
    const { action, userId, password } = readBody(req);
    const id = Number(userId);
    if (!id) return res.status(400).json({ error: 'userId is required' });

    const target = await getUserById(id);
    if (!target) return res.status(404).json({ error: 'No such account' });

    // Nobody means to lock themselves out of their own admin panel, and the
    // only way back would be an environment change and a redeploy.
    if (target.id === me.id && action === 'disable')
      return res.status(400).json({ error: 'You cannot switch off your own account.' });

    if (action === 'disable' || action === 'enable') {
      const updated = await setUserActive(id, action === 'enable');
      return res.status(200).json({ user: updated });
    }

    if (action === 'set_password') {
      if (!password || String(password).length < 6)
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      await setUserPassword(id, await hashPassword(String(password)));
      // Said plainly rather than glossed over: tokens are self-contained and
      // there is no revocation list, so a password change does NOT sign out a
      // phone that is already signed in. Switching the account off and on does.
      return res.status(200).json({
        ok: true,
        note: 'Password changed. A phone that is already signed in stays signed in — switch the account off and back on to force it out.'
      });
    }

    return res.status(400).json({ error: 'action must be enable, disable or set_password' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ------------------------------------------------------------------- read
  const users = await listUsers();
  const activity = await listActivity({ limit: 500 });
  const statuses = await listLeadStatuses({ limit: 300 });

  const blank = () =>
    ({ searches: 0, pitches: 0, logins: 0, contacted: 0, quoted: 0, won: 0, notInterested: 0, total: 0 });
  const counts = new Map();
  const bump = (uid, key) => {
    const c = counts.get(uid) || blank();
    c[key]++; c.total++;
    counts.set(uid, c);
  };
  for (const a of activity) {
    if (a.type === 'search') bump(a.user_id, 'searches');
    else if (a.type === 'generate_pitch') bump(a.user_id, 'pitches');
    else if (a.type === 'login') bump(a.user_id, 'logins');
  }
  // Outcomes are counted from the status table rather than the activity feed,
  // so re-marking the same lead twice does not inflate anybody's numbers.
  const KEY = { contacted: 'contacted', quoted: 'quoted', won: 'won', not_interested: 'notInterested' };
  for (const s of statuses) {
    const k = KEY[s.status];
    if (!k || !s.updated_by) continue;
    const c = counts.get(s.updated_by) || blank();
    c[k]++;
    counts.set(s.updated_by, c);
  }

  const reps = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active !== false,
    last_seen: u.last_seen || null,
    created_at: u.created_at,
    stats: counts.get(u.id) || blank()
  }));

  const totals = statuses.reduce((t, s) => { t[s.status] = (t[s.status] || 0) + 1; return t; }, {});

  res.status(200).json({ reps, recentActivity: activity.slice(0, 100), recentStatuses: statuses.slice(0, 50), totals });
}
