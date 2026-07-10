import { initDb, logActivity } from '../_lib/db.js';
import { getAuthUser } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

// -----------------------------------------------------------------------------
// Business discovery via OpenStreetMap's Overpass API.
// 100% free: no API key, no credit card, no billing account.
// (Data is community-sourced, so coverage varies by area vs. Google, but it's
//  real business data and completely free to query.)
// -----------------------------------------------------------------------------

const MILES_TO_METERS = 1609.34;
const MAX_RADIUS_METERS = 40000; // keep queries fast + within serverless time limits
const MAX_RESULTS = 50;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// Map full US state names to 2-letter codes (Overpass addr:state is usually the
// code already, but not always).
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

async function queryOverpass(ql) {
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
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
      return await r.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
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
  const R = Math.round(radius);

  // Union query: named commercial POIs (shops, offices, crafts, key amenities,
  // hotels, gyms) within the radius. `out center` gives coords for ways too.
  const ql = `[out:json][timeout:20];
(
  nwr(around:${R},${lat},${lng})["shop"]["name"];
  nwr(around:${R},${lat},${lng})["office"]["name"];
  nwr(around:${R},${lat},${lng})["craft"]["name"];
  nwr(around:${R},${lat},${lng})["amenity"~"^(restaurant|cafe|bar|fast_food|pub|bakery|pharmacy|bank|fuel|car_wash|car_rental|dentist|doctors|clinic|veterinary|marketplace|cinema|nightclub)$"]["name"];
  nwr(around:${R},${lat},${lng})["tourism"~"^(hotel|motel|guest_house|hostel)$"]["name"];
  nwr(around:${R},${lat},${lng})["leisure"~"^(fitness_centre|sports_centre)$"]["name"];
);
out center ${MAX_RESULTS * 3};`;

  let data;
  try {
    data = await queryOverpass(ql);
  } catch (err) {
    return res.status(502).json({
      error:
        'Business lookup timed out. Try a smaller radius (the free map service is slower on big areas).',
      detail: String(err)
    });
  }

  const seen = new Set();
  const businesses = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    if (!t.name) continue;
    const bLat = el.lat ?? el.center?.lat;
    const bLng = el.lng ?? el.lon ?? el.center?.lon;
    if (typeof bLat !== 'number' || typeof bLng !== 'number') continue;

    const key = `${t.name}|${bLat.toFixed(4)},${bLng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    businesses.push({
      id: `${el.type}/${el.id}`,
      name: t.name,
      address: buildAddress(t),
      type: deriveType(t),
      types: [t.shop, t.amenity, t.office, t.craft, t.tourism, t.leisure].filter(Boolean),
      phone: t.phone || t['contact:phone'] || '',
      lat: bLat,
      lng: bLng,
      state: normalizeState(t['addr:state']),
      _dist: distanceMeters(lat, lng, bLat, bLng)
    });
  }

  businesses.sort((a, b) => a._dist - b._dist);
  const trimmed = businesses.slice(0, MAX_RESULTS).map(({ _dist, ...b }) => b);

  await initDb();
  await logActivity({
    user_id: auth.uid,
    type: 'search',
    lat,
    lng,
    detail: { radiusMiles, count: trimmed.length }
  });

  res.status(200).json({ businesses: trimmed });
}
