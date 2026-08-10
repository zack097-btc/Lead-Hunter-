import React from 'react';

// A lead's score is only useful if it tells the rep what to DO. So the list
// shows the band, not the number: which doors to knock on first, and why this
// one is on the list at all.
function band(score) {
  if (score >= 75) return { cls: 'hot', label: 'HOT' };
  if (score >= 55) return { cls: 'warm', label: 'GOOD' };
  if (score >= 35) return { cls: 'cool', label: 'MAYBE' };
  return { cls: 'cold', label: 'LOW' };
}

function telHref(phone) {
  return `tel:${String(phone).replace(/[^0-9+]/g, '')}`;
}

export default function ListView({ businesses, onSelect, searching }) {
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
      {businesses.map((b) => {
        const t = band(b.score ?? 40);
        return (
          <div className={`lead ${t.cls}`} key={b.id}>
            <div className="lead-head">
              <span className={`score ${t.cls}`}>{t.label}</span>
              <span className="type">{b.type}</span>
              {b.distanceMiles != null && <span className="dist">{b.distanceMiles} mi</span>}
            </div>

            <h3>{b.name}</h3>
            {b.address && <div className="meta">{b.address}</div>}

            {/* Why this is worth a walk-in. The rep should never have to guess
                what the app saw in a business. */}
            {b.why?.length > 0 && <div className="why">{b.why[0]}</div>}

            <div className="actions">
              {b.phone ? (
                <a className="act" href={telHref(b.phone)}>
                  📞 Call
                </a>
              ) : (
                <span className="act disabled" title="No phone number in the map data">
                  No phone
                </span>
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
                <a className="act" href={b.website} target="_blank" rel="noreferrer">
                  🌐 Site
                </a>
              )}
              <button className="act primary" type="button" onClick={() => onSelect(b)}>
                ✍️ Pitch
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
