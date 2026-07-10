import { initDb, logActivity, listActivity } from '../_lib/db.js';
import { getAuthUser } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  await initDb();

  // Log a client-side activity event (e.g. viewing a business).
  if (req.method === 'POST') {
    const { type, business_name, business_address, lat, lng, detail } = readBody(req);
    if (!type) return res.status(400).json({ error: 'type is required' });
    await logActivity({
      user_id: auth.uid,
      type: String(type),
      business_name,
      business_address,
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
      detail: detail || null
    });
    return res.status(201).json({ ok: true });
  }

  // List activity. Reps see their own; admins can pass ?scope=all.
  if (req.method === 'GET') {
    const scopeAll = req.query?.scope === 'all' && auth.role === 'admin';
    const rows = await listActivity({ userId: scopeAll ? null : auth.uid, limit: 200 });
    return res.status(200).json({ activity: rows });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
