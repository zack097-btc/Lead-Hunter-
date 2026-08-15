import React, { useState } from 'react';

// A lead's score is only useful if it tells the rep what to DO. So the list
// shows the band, not the number: which doors to knock on first, and why this
// one is on the list at all.
function band(score) {
  if (score >= 75) return { cls: 'hot', label: 'HOT' };
  if (score >= 55) return { cls: 'warm', label: 'GOOD' };
  if (score >= 35) return { cls: 'cool', label: 'MAYBE' };
  return { cls: 'cold', label: 'LOW' };
}

// Four buttons, not eleven. Someone standing on a pavement in the rain will use
// four. The order matches the order these things actually happen in.
const STATUSES = [
  { key: 'contacted', label: 'Talked to', short: 'TALKED TO' },
  { key: 'quoted', label: 'Quoted', short: 'QUOTED' },
  { key: 'won', label: 'Won', short: 'WON' },
  { key: 'not_interested', label: 'No', short: 'NOT INTERESTED' }
];

function telHref(phone) {
  return `tel:${String(phone).replace(/[^0-9+]/g, '')}`;
}

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60); if (m < 90) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 36) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

function Lead({ b, onSelect, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const t = band(b.score ?? 40);
  const cur = b.leadStatus || '';

  async function mark(key) {
    if (busy) return;
    setBusy(true);
    try {
      // Tapping the status it already has clears it. That is how a mis-tap gets
      // undone, and every button needs a way back.
      await onStatus(b, cur === key ? '' : key);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`lead ${t.cls}${cur ? ' worked' : ''}${cur === 'not_interested' ? ' dead' : ''}`}>
      <div className="lead-head">
        <span className={`score ${t.cls}`}>{t.label}</span>
        <span className="type">{b.type}</span>
        {b.distanceMiles != null && <span className="dist">{b.distanceMiles} mi</span>}
      </div>

      <h3>{b.name}</h3>
      {b.address && <div className="meta">{b.address}</div>}

      {/* Why this is worth a walk-in. The rep should never have to guess what
          the app saw in a business. Once it has been worked, the outcome is the
          more useful thing to show in that space. */}
      {b.why?.length > 0 && !cur && <div className="why">{b.why[0]}</div>}

      {cur && (
        <div className={`status-line ${cur}`}>
          <b>{STATUSES.find((s) => s.key === cur)?.short || cur}</b>
          {b.leadBy ? ` · ${b.leadBy}` : ''}{b.leadAt ? ` · ${ago(b.leadAt)}` : ''}
          {b.leadNote ? <div className="status-note">“{b.leadNote}”</div> : null}
        </div>
      )}

      <div className="actions">
        {b.phone ? (
          <a className="act" href={telHref(b.phone)}>📞 Call</a>
        ) : (
          <span className="act disabled" title="No phone number in the map data">No phone</span>
        )}
        <a
          className="act"
          href={`https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`}
          target="_blank"
          rel="noreferrer"
        >
          🧭 Directions
        </a>
        {b.website && (
          <a className="act" href={b.website} target="_blank" rel="noreferrer">🌐 Site</a>
        )}
        <button className="act primary" type="button" onClick={() => onSelect(b)}>✍️ Pitch</button>
      </div>

      {/* Folded away by default. The list is for finding the next door; marking
          one is what you do after, and it should not compete for the space. */}
      <button
        className="mark-toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '▾ ' : '▸ '}{cur ? 'Change what happened' : 'Mark what happened'}
      </button>

      {open && (
        <div className="mark-row">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={busy}
              className={`mark ${s.key}${cur === s.key ? ' on' : ''}`}
              onClick={() => mark(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ListView({ businesses, onSelect, searching, onStatus }) {
  if (searching && !businesses.length) {
    return (
      <div className="list">
        {[0, 1, 2, 3].map((i) => (
          <div className="lead skeleton" key={i} aria-hidden="true">
            <div className="sk sk-badge" />
            <div className="sk sk-title" />
            <div className="sk sk-line" />
            <div className="sk sk-line short" />
          </div>
        ))}
      </div>
    );
  }

  if (!businesses.length) {
    return (
      <div className="list">
        <div className="empty">
          <b>No leads yet.</b>
          <br />
          Tap <b>Search this area</b> to find businesses near you.
          <br />
          <br />
          Finding nothing in a built-up area usually means the radius is too
          small — try 5 or 10 miles.
        </div>
      </div>
    );
  }

  return (
    <div className="list">
      {businesses.map((b) => (
        <Lead key={b.id} b={b} onSelect={onSelect} onStatus={onStatus} />
      ))}
    </div>
  );
}
