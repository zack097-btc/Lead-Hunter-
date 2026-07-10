// Tiny API client. Token is kept in localStorage so reps stay logged in.

const TOKEN_KEY = 'jzac_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  register: (email, password, name) =>
    request('/api/auth/register', { method: 'POST', body: { email, password, name } }),
  me: () => request('/api/auth/me'),
  nearby: (lat, lng, radiusMiles, types) =>
    request('/api/places/nearby', { method: 'POST', body: { lat, lng, radiusMiles, types } }),
  pitch: (businessName, businessType, address) =>
    request('/api/ai/pitch', { method: 'POST', body: { businessName, businessType, address } }),
  logActivity: (entry) => request('/api/activity', { method: 'POST', body: entry }),
  adminReps: () => request('/api/admin/reps')
};
