import {
  initDb, setLeadStatus, clearLeadStatus, listLeadStatuses,
  logActivity, getUserById, LEAD_STATUSES
} from '../_lib/db.js';
import { getAuthUser } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

// -----------------------------------------------------------------------------
// What happened at each door.
//
// Status is shared across the whole team rather than kept per rep. Two people
// working the same street should not both walk into a business that already
// said no last month - that is the single most annoying thing a door-knocking
// tool can do to the person doing the knocking, and to the business.
// -----------------------------------------------------------------------------

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  await initDb();

  const me = await getUserById(auth.uid);
  if (!me) return res.status(401).json({ error: 'Account no longer exists' });
  if (me.active === false)
    return res.status(403).json({ error: 'This account has been switched off. Speak to Zack.' });

  if (req.method === 'GET') {
    return res.status(200).json({ statuses: await listLeadStatuses({ limit: 300 }) });
  }

  if (req.method === 'POST') {
    const { business_id, status, note, business_name, business_address, lat, lng } = readBody(req);
    if (!business_id) return res.status(400).json({ error: 'business_id is required' });

    // An empty status clears the mark - that is how a rep undoes a mis-tap,
    // and there needs to be a way back from every button.
    if (!status) {
      await clearLeadStatus(business_id);
      logActivity({ user_id: auth.uid, type: 'lead_status_cleared', business_name: business_name || '' })
        .catch(() => {});
      return res.status(200).json({ cleared: true, business_id });
    }

    if (!LEAD_STATUSES.includes(String(status)))
      return res.status(400).json({ error: `status must be one of: ${LEAD_STATUSES.join(', ')}` });

    const row = await setLeadStatus({
      business_id, status, note: String(note || '').slice(0, 500),
      business_name: String(business_name || '').slice(0, 200),
      business_address: String(business_address || '').slice(0, 300),
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
      updated_by: auth.uid
    });

    // Logged so the Team view shows outcomes, not just effort. Fire-and-forget:
    // a logging failure must never lose the rep's actual update.
    logActivity({
      user_id: auth.uid, type: 'lead_status', business_name: business_name || '',
      business_address: business_address || '',
      lat: typeof lat === 'number' ? lat : null, lng: typeof lng === 'number' ? lng : null,
      detail: { status, note: String(note || '').slice(0, 200) }
    }).catch(() => {});

    return res.status(200).json({ status: row });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
