import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

// The Team view answers two different questions and should not confuse them.
// EFFORT is searches and pitches: who is out there working. OUTCOMES are quotes
// and wins: who is actually selling. They are not reliably the same person, and
// a panel that only counts effort quietly rewards the wrong thing.

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60); if (m < 90) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 36) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

export default function AdminPanel() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);

  function load() {
    api.adminReps().then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function act(rep, action) {
    if (action === 'disable' &&
        !confirm(`Switch off ${rep.name || rep.email}?\n\nThey will be signed out the next time they open the app and cannot sign back in. Their history is kept, and you can switch them back on at any time.`))
      return;

    let password;
    if (action === 'set_password') {
      password = prompt(`New password for ${rep.name || rep.email} (at least 6 characters).\n\nYou will need to tell them what it is — they cannot see it here.`);
      if (!password) return;
    }

    setBusy(rep.id);
    try {
      const res = await api.repAction(action, rep.id, password);
      if (res?.note) alert(res.note);
      load();
    } catch (e) {
      alert('That did not work: ' + e.message);
    } finally {
      setBusy(0);
    }
  }

  if (error) return <div className="admin"><div className="error">{error}</div></div>;
  if (!data) return <div className="admin"><div className="loading-dots">Loading team activity…</div></div>;

  const sum = (k) => data.reps.reduce((n, r) => n + (r.stats[k] || 0), 0);
  const t = data.totals || {};

  return (
    <div className="admin">
      <div className="stat-grid">
        <div className="stat"><div className="n">{data.reps.filter((r) => r.active).length}</div><div className="l">Active</div></div>
        <div className="stat"><div className="n">{sum('searches')}</div><div className="l">Searches</div></div>
        <div className="stat"><div className="n">{t.quoted || 0}</div><div className="l">Quoted</div></div>
        <div className="stat"><div className="n">{t.won || 0}</div><div className="l">Won</div></div>
      </div>

      <div className="section-title">Reps</div>
      <div className="rep-list">
        {data.reps.map((r) => (
          <div className={`rep-card${r.active ? '' : ' off'}`} key={r.id}>
            <div className="rep-top">
              <div>
                <b>{r.name || r.email}</b>
                {r.role === 'admin' && <span className="badge">ADMIN</span>}
                {!r.active && <span className="badge off">OFF</span>}
                <div className="rep-sub">{r.email}</div>
                <div className="rep-sub">Last used {ago(r.last_seen)}</div>
              </div>
            </div>

            <div className="rep-stats">
              <span>{r.stats.searches} searches</span>
              <span>{r.stats.pitches} pitches</span>
              <span className="good">{r.stats.quoted} quoted</span>
              <span className="good">{r.stats.won} won</span>
              <span className="dim">{r.stats.notInterested} no</span>
            </div>

            <div className="rep-actions">
              {r.active ? (
                <button
                  type="button"
                  disabled={busy === r.id || r.id === user.id}
                  title={r.id === user.id ? 'You cannot switch off your own account' : ''}
                  onClick={() => act(r, 'disable')}
                >
                  Switch off
                </button>
              ) : (
                <button type="button" disabled={busy === r.id} onClick={() => act(r, 'enable')}>
                  Switch back on
                </button>
              )}
              <button type="button" disabled={busy === r.id} onClick={() => act(r, 'set_password')}>
                Set password
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">Recent outcomes</div>
      {(data.recentStatuses || []).map((s) => (
        <div className="feed-item" key={s.business_id + s.updated_at}>
          <div>
            <b>{s.updated_by_name || 'someone'}</b> marked <b>{s.business_name || s.business_id}</b>{' '}
            <span className={`tag ${s.status}`}>{s.status.replace('_', ' ')}</span>
          </div>
          <div className="when">{new Date(s.updated_at).toLocaleString()}</div>
        </div>
      ))}
      {!(data.recentStatuses || []).length && <div className="empty">Nothing marked yet.</div>}

      <div className="section-title">Recent activity</div>
      {data.recentActivity.map((a) => (
        <div className="feed-item" key={a.id}>
          <div>
            <b>{a.user_name || a.user_email}</b> — {labelFor(a)}
          </div>
          <div className="when">{new Date(a.created_at).toLocaleString()}</div>
        </div>
      ))}
      {!data.recentActivity.length && <div className="empty">No activity yet.</div>}
    </div>
  );
}

function labelFor(a) {
  switch (a.type) {
    case 'login':
      return 'signed in';
    case 'register':
      return 'created account';
    case 'search':
      return `searched (${a.detail?.count ?? '?'} results, ${a.detail?.radiusMiles ?? '?'} mi)`;
    case 'generate_pitch':
      return `wrote a pitch for ${a.business_name}${a.detail?.source === 'ai' ? '' : ' (template)'}`;
    case 'view_business':
      return `viewed ${a.business_name}`;
    case 'lead_status':
      return `marked ${a.business_name} ${String(a.detail?.status || '').replace('_', ' ')}`;
    case 'lead_status_cleared':
      return `cleared the mark on ${a.business_name}`;
    default:
      return a.type;
  }
}
