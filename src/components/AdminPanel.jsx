import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AdminPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .adminReps()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="admin"><div className="error">{error}</div></div>;
  if (!data) return <div className="admin"><div className="loading-dots">Loading team activity…</div></div>;

  const totalSearches = data.reps.reduce((n, r) => n + r.stats.searches, 0);
  const totalPitches = data.reps.reduce((n, r) => n + r.stats.pitches, 0);

  return (
    <div className="admin">
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{data.reps.length}</div>
          <div className="l">Accounts</div>
        </div>
        <div className="stat">
          <div className="n">{totalSearches}</div>
          <div className="l">Searches</div>
        </div>
        <div className="stat">
          <div className="n">{totalPitches}</div>
          <div className="l">Pitches</div>
        </div>
      </div>

      <div className="section-title">Reps</div>
      <table className="reps">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Searches</th>
            <th>Pitches</th>
          </tr>
        </thead>
        <tbody>
          {data.reps.map((r) => (
            <tr key={r.id}>
              <td>
                {r.name}
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.email}</div>
              </td>
              <td>{r.role}</td>
              <td>{r.stats.searches}</td>
              <td>{r.stats.pitches}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-title">Recent Activity</div>
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
      return `generated pitch for ${a.business_name}`;
    case 'view_business':
      return `viewed ${a.business_name}`;
    default:
      return a.type;
  }
}
