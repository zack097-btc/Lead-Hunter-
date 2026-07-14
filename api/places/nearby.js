import { initDb, logActivity } from '../_lib/db.js';
import { getAuthUser } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

// -----------------------------------------------------------------------------
// Business discovery via OpenStreetMap's Overpass API.
// 100% free: no API key, no credit card, no billing account.
// -----------------------------------------------------------------------------

const MILES_TO_METERS = 1609.34;
const MAX_RADIUS_METERS = 40000;
const MAX_RESULTS = 50;

// Only the main instance is used on purpose. Do NOT add regional mirrors here:
// overpass.osm.ch only holds Swiss data and answers US queries with HTTP 200 +
// zero results, which silently looks like "no businesses nearby" rather than an
// error. overpass.kumi.systems and overpass.private.coffee were unresponsive.
const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter'];
const OVERPASS_ATTEMPTS = 2; // the main instance throws transient 429/504s
const OVERPASS_TIMEOUT_MS = 26000;

// Search ladder. We only ever return the MAX_RESULTS nearest businesses, so a
// dense area is fully satisfied by a small box. Querying the rep's full radius
// up front makes Overpass compute a huge area and then throws ~all of it away —
// which times out (504) on 10-25mi in a city. Instead we start small and only
// widen when we haven't found enough. Rural areas do widen, but sparse data
// keeps those queries cheap either way.
const LADDER_MILES = [2, 8];

const STATE_NAME_TO_CODE = {
  washington: 'WA',
  'new york': 'NY',
  georgia: 'GA',
  florida: 'FL',
  oregon: 'OR',
  montana: 'MT',
  idaho: 'ID'
};

function normalizeState(raw = '') {
  const s = String(raw).trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_NAME_TO_CODE[s.toLowerCase()] || '';
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildAddress(t = {}) {
  const line1 = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const cityState = [t['addr:city'], [t['addr:state'], t['addr:postcode']].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [line1, cityState].filter(Boolean).join(', ');
}

function deriveType(t = {}) {
  const raw =
    (t.shop && t.shop !== 'yes' && t.shop) ||
    t.amenity ||
    (t.office && `${t.office} office`) ||
    t.craft ||
    t.tourism ||
    t.leisure ||
    t.shop ||
    'business';
  return String(raw).replace(/_/g, ' ');
}

// Overpass bbox queries use the spatial index and are dramatically faster than
// `around:` radius queries, which time out server-side on large radii.
function boundingBox(lat, lng, radiusMeters) {
  const dLat = radiusMeters / 111320;
  const dLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map((n) => n.toFixed(5)).join(',');
}

function buildQuery(bb) {
  return `[out:json][timeout:50];
(
  nwr["shop"]["name"](${bb});
  nwr["office"]["name"](${bb});
  nwr["craft"]["name"](${bb});
  nwr["amenity"~"^(restaurant|cafe|bar|fast_food|pub|bakery|pharmacy|bank|fuel|car_wash|car_rental|dentist|doctors|clinic|veterinary|marketplace|cinema|nightclub)$"]["name"](${bb});
  nwr["tourism"~"^(hotel|motel|guest_house|hostel)$"]["name"](${bb});
  nwr["leisure"~"^(fitness_centre|sports_centre)$"]["name"](${bb});
);
out center ${MAX_RESULTS * 6};`;
}

async function queryOverpass(ql) {
  let lastErr;
  const targets = [];
  for (let i = 0; i < OVERPASS_ATTEMPTS; i++) targets.push(...OVERPASS_ENDPOINTS);

  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 1500)); // brief backoff
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'JZacLeadGenerator/1.0 (contact: JZacDesigns)'
        },
        body: 'data=' + encodeURIComponent(ql),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!r.ok) {
        lastErr = new Error(`Overpass responded ${r.status}`);
        continue;
      }
      // Overpass returns plain text (not JSON) when rate-limiting or erroring.
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        lastErr = new Error(`Overpass returned a non-JSON response: ${text.slice(0, 120)}`);
        continue;
      }
      // Overpass signals its own server-side timeout via `remark` while still
      // returning HTTP 200 with an empty set.
      if (!(data.elements || []).length && data.remark) {
        lastErr = new Error(`Overpass remark: ${data.remark}`);
        continue;
      }
      return data;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass request failed');
}

// Convert raw Overpass elements into lead objects within the true radius.
function toBusinesses(data, lat, lng, radius) {
  const seen = new Set();
  const out = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    if (!t.name) continue;
    const bLat = el.lat ?? el.center?.lat;
    const bLng = el.lon ?? el.center?.lon;
    if (typeof bLat !== 'number' || typeof bLng !== 'number') continue;

    const key = `${t.name}|${bLat.toFixed(4)},${bLng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const dist = distanceMeters(lat, lng, bLat, bLng);
    if (dist > radius) continue; // bbox is a square; keep the circle

    out.push({
      id: `${el.type}/${el.id}`,
      name: t.name,
      address: buildAddress(t),
      type: deriveType(t),
      types: [t.shop, t.amenity, t.office, t.craft, t.tourism, t.leisure].filter(Boolean),
      phone: t.phone || t['contact:phone'] || '',
      lat: bLat,
      lng: bLng,
      state: normalizeState(t['addr:state']),
      _dist: dist
    });
  }
  return out.sort((a, b) => a._dist - b._dist);
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  const { lat, lng, radiusMiles = 5 } = readBody(req);
  if (typeof lat !== 'number' || typeof lng !== 'number')
    return res.status(400).json({ error: 'lat and lng (numbers) are required' });

  const radius = Math.min(Math.max(Number(radiusMiles) || 5, 1) * MILES_TO_METERS, MAX_RADIUS_METERS);

  // Ascending search steps, each capped at the requested radius.
  const steps = [...new Set([...LADDER_MILES.map((m) => m * MILES_TO_METERS), radius])]
    .filter((r) => r <= radius)
    .sort((a, b) => a - b);

  let best = [];
  let lastErr = null;
  for (const stepRadius of steps) {
    try {
      const data = await queryOverpass(buildQuery(boundingBox(lat, lng, stepRadius)));
      const found = toBusinesses(data, lat, lng, radius);
      if (found.length > best.length) best = found;
      if (best.length >= MAX_RESULTS) break; // enough nearby leads; stop widening
    } catch (err) {
      lastErr = err;
      // Keep whatever a smaller step already found rather than failing outright.
      if (best.length) break;
    }
  }

  if (!best.length && lastErr) {
    return res.status(502).json({
      error: 'The free map service is busy right now. Please try again in a moment.',
      detail: String(lastErr.message || lastErr)
    });
  }

  const businesses = best.slice(0, MAX_RESULTS).map(({ _dist, ...b }) => b);

  await initDb();
  await logActivity({
    user_id: auth.uid,
    type: 'search',
    lat,
    lng,
    detail: { radiusMiles, count: businesses.length }
  });

  res.status(200).json({ businesses });
}
