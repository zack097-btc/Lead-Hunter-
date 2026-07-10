import React from 'react';

const OPTIONS = [1, 5, 10, 15, 25];

export default function RadiusSelector({ value, onChange }) {
  return (
    <div className="seg" role="group" aria-label="Search radius in miles">
      {OPTIONS.map((mi) => (
        <button
          key={mi}
          className={value === mi ? 'active' : ''}
          onClick={() => onChange(mi)}
          type="button"
        >
          {mi} mi
        </button>
      ))}
    </div>
  );
}
