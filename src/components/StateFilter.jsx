import React from 'react';
import { STATES } from '../config/states.js';

// Shows a chip per state. Disabled states (not yet launched) are dimmed.
export default function StateFilter({ selected, onToggle }) {
  return (
    <div className="row" aria-label="State territory filter">
      {STATES.map((s) => {
        const on = selected.includes(s.code);
        return (
          <button
            key={s.code}
            type="button"
            className={`chip ${on ? 'on' : ''}`}
            onClick={() => s.enabled && onToggle(s.code)}
            disabled={!s.enabled}
            title={s.enabled ? s.name : `${s.name} (coming soon)`}
          >
            {s.code}
            {!s.enabled ? ' •' : ''}
          </button>
        );
      })}
    </div>
  );
}
