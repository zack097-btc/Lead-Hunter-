import React from 'react';

export default function ListView({ businesses, onSelect }) {
  if (!businesses.length) {
    return (
      <div className="list">
        <div className="empty">
          No businesses to show yet.
          <br />
          Tap <b>Search this area</b> to find leads near you.
        </div>
      </div>
    );
  }

  return (
    <div className="list">
      {businesses.map((b) => (
        <div className="lead" key={b.id}>
          <span className="type">{b.type}</span>
          <h3>{b.name}</h3>
          <div className="meta">{b.address}</div>
          {b.phone && <div className="meta">{b.phone}</div>}
          <div className="actions">
            {b.phone && <a href={`tel:${b.phone.replace(/[^0-9+]/g, '')}`}>Call</a>}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${b.name} ${b.address}`
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Map
            </a>
            <button className="primary" type="button" onClick={() => onSelect(b)}>
              Generate Pitch
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
