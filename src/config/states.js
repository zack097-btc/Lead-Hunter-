// Territory configuration.
// To add a new state later, just add an entry here and set enabled: true.
// The rest of the app reads this list automatically - no other code changes.
export const STATES = [
  { code: 'WA', name: 'Washington', enabled: true },
  { code: 'NY', name: 'New York', enabled: true },
  { code: 'GA', name: 'Georgia', enabled: false },
  { code: 'FL', name: 'Florida', enabled: false },
  { code: 'OR', name: 'Oregon', enabled: false },
  { code: 'MT', name: 'Montana', enabled: false },
  { code: 'ID', name: 'Idaho', enabled: false }
];

// States active out of the box (used as the default filter selection).
export const DEFAULT_STATE_CODES = STATES.filter((s) => s.enabled).map((s) => s.code);
