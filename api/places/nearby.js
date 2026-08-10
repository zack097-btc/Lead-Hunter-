import { initDb, logActivity, getCachedElements, putCachedElements } from '../_lib/db.js';
import { getAuthUser } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

// -----------------------------------------------------------------------------
// Business discovery via OpenStreetMap's Overpass API.
// 100% free: no API key, no credit card, no billing account.
//
// Three things this has to get right, in this order:
//
//   1. NEVER HANG. Overpass is a free shared service and it has bad days. The
//      whole request runs against one wall-clock budget, and when the budget is
//      gone it returns whatever it has with an honest note rather than sitting
//      there until the platform kills the function. A rep standing outside a
//      shop needs an answer or a clear "try again", not a spinner.
//   2. BE FAST THE SECOND TIME. Raw Overpass answers are cached for a week.
//      Businesses do not move. The RAW elements are cached rather than the
//      finished list, so distance and ranking are still computed for wherever
//      the rep is actually standing.
//   3. RANK BY WHO ACTUALLY BUYS VINYL. Nearest-first is not most-useful-first.
//      A plumber with three vans is a better door than the bank next to it.
// -----------------------------------------------------------------------------

const MILES_TO_METERS = 1609.34;
const MAX_RADIUS_METERS = 40000;
const MAX_RESULTS = 60;

// Measured from a browser against Mill Creek WA, 10 August 2026:
//   overpass-api.de        200, 60 results, 1.4 s   <- primary
//   overpass.kumi.systems  200, 60 results, 8.0 s   <- works, slower
//   overpass.private.coffee 200, 60 results, 19.3 s <- works, slowest
//   overpass.osm.jp        no CORS, unusable from anywhere
// An earlier note in this file claimed the middle two were unresponsive. They
// are not; that was a bad day for them. They are kept as ordered fallbacks
// because the primary throwing a 429 or 504 is the single most common cause of
// a failed search. overpass.osm.ch is still deliberately absent: it holds only
// Swiss data and answers US queries with HTTP 200 and zero results, which looks
// exactly like "no businesses nearby" instead of like an error.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

// vercel.json allows the function 90 s. Everything below is sized to finish
// well inside that with room to log and respond, because a function killed by
// the platform returns no error the browser can explain to anybody.
const TOTAL_BUDGET_MS = 55000;
const MIN_ATTEMPT_MS = 6000;
const MAX_ATTEMPT_MS = 20000;

// Start small and widen only if we are short of leads. Asking for the rep's
// full radius up front makes Overpass compute a huge area and then throws most
// of it away, which is what used to produce 504s on a 10-25 mile search in a
// city. Dense areas are satisfied by the first step; rural areas widen, but
// sparse data keeps those queries cheap anyway.
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
    t.craft ||
    t.amenity ||
    (t.office && `${t.office} office`) ||
    t.tourism ||
    t.leisure ||
    t.industrial ||
    t.shop ||
    'business';
  return String(raw).replace(/_/g, ' ');
}

// -----------------------------------------------------------------------------
// Lead scoring
//
// The job is vinyl: vehicle lettering and USDOT numbers, storefront window and
// door graphics, boat registration numbers, fleet decals. Those wants are not
// spread evenly across the businesses on a map, so neither is the ranking.
//
// The single strongest signal is A VEHICLE THAT IS ALSO AN ADVERTISEMENT. Every
// trade running a van or a truck is legally required to letter it (USDOT) or
// wants to (everyone else). That beats proximity every time - a plumber a mile
// away is a better door than the branch bank across the street.
// -----------------------------------------------------------------------------

// Trades and services that run lettered vehicles. Highest value by a distance.
const FLEET_TRADES = new Set([
  'plumber', 'electrician', 'hvac', 'roofer', 'carpenter', 'builder', 'painter',
  'gardener', 'landscape_gardener', 'tiler', 'stonemason', 'glaziery', 'locksmith',
  'metal_construction', 'scaffolder', 'insulation', 'window_construction',
  'chimney_sweeper', 'floorer', 'plasterer', 'pest_control', 'sawmill', 'handyman',
  'caterer', 'electronics_repair'
]);

// Anything that moves goods or people, i.e. anything needing a DOT number.
const VEHICLE_BUSINESS = new Set([
  'car_repair', 'car_parts', 'car', 'truck', 'truck_repair', 'tyres', 'car_wash',
  'motorcycle', 'motorcycle_repair', 'trailer', 'caravan', 'agrarian',
  'driving_school', 'boat', 'boat_repair', 'fishing', 'atv', 'snowmobile'
]);

// On the water: registration numbers and boat names are core JZAC work.
const MARINE = new Set(['marina', 'slipway', 'boat_rental', 'boat_sharing', 'fuel;marina']);

// Storefronts: hours decals, window graphics, door lettering.
const STOREFRONT = new Set([
  'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'bakery', 'ice_cream',
  'hairdresser', 'beauty', 'barber', 'nail_salon', 'tattoo', 'massage',
  'butcher', 'greengrocer', 'florist', 'optician', 'pharmacy', 'laundry',
  'dry_cleaning', 'convenience', 'hardware', 'doityourself', 'pet', 'pet_grooming',
  'furniture', 'clothes', 'shoes', 'jewelry', 'gift', 'sports', 'bicycle',
  'brewery', 'winery', 'deli', 'seafood', 'garden_centre'
]);

// Real prospects, just less urgent than a van or a shop window.
const PROFESSIONAL = new Set([
  'fitness_centre', 'sports_centre', 'dentist', 'doctors', 'clinic', 'veterinary',
  'childcare', 'kindergarten', 'hotel', 'motel', 'guest_house', 'storage_rental',
  'estate_agent', 'insurance', 'company', 'contractor', 'logistics', 'moving_company',
  'construction_company', 'employment_agency', 'lawyer', 'accountant'
]);

// Corporate-owned: signage is bought nationally by a brand team, not by the
// person behind the counter. Not worthless, but not a walk-in.
const LOW_VALUE = new Set(['bank', 'atm', 'fuel', 'post_office', 'townhall', 'library', 'school']);

export function scoreBusiness(t = {}, tags = []) {
  const set = new Set(tags.map((x) => String(x).toLowerCase()));
  let score = 30;
  const why = [];

  if (tags.some((x) => FLEET_TRADES.has(String(x).toLowerCase()))) {
    score += 45; why.push('trade — likely running lettered vans');
  }
  if (tags.some((x) => VEHICLE_BUSINESS.has(String(x).toLowerCase()))) {
    score += 40; why.push('vehicle business — fleet and USDOT work');
  }
  if (tags.some((x) => MARINE.has(String(x).toLowerCase()))) {
    score += 45; why.push('marine — registration numbers and boat names');
  }
  if (tags.some((x) => STOREFRONT.has(String(x).toLowerCase()))) {
    score += 25; why.push('storefront — window and door graphics');
  }
  if (tags.some((x) => PROFESSIONAL.has(String(x).toLowerCase()))) {
    score += 15; why.push('premises signage');
  }
  if (tags.some((x) => LOW_VALUE.has(String(x).toLowerCase()))) {
    score -= 25; why.push('signage usually bought at corporate level');
  }

  // A national brand decides signage centrally. OSM records this properly, so
  // use it rather than guessing from the name.
  if (t.brand || t['brand:wikidata']) {
    score -= 30; why.push('chain — decisions made off-site');
  }

  // Somebody you can actually reach today is worth more than somebody you can't.
  if (t.phone || t['contact:phone']) { score += 12; why.push('phone listed'); }

  // A food truck is a rolling billboard and a near-perfect fit. This goes to
  // the FRONT of the reasons: it is mapped as fast food, so the storefront
  // reason fires first and would otherwise be the headline, which reads as
  // "window graphics" for a business whose whole premises is a vehicle.
  if (set.has('fast_food') && /truck|trailer|cart|mobile/i.test(t.name || '')) {
    score += 30; why.unshift('mobile vendor — full vehicle wrap candidate');
  }

  // Ranking is relative, so a floor of zero costs nothing and keeps a negative
  // score from ever surfacing in the UI as something a person has to interpret.
  return { score: Math.max(0, score), why };
}

// Overpass bbox queries use the spatial index and are dramatically faster than
// `around:` radius queries, which time out server-side on large radii.
function boundingBox(lat, lng, radiusMeters) {
  const dLat = radiusMeters / 111320;
  const dLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map((n) => n.toFixed(4)).join(',');
}

function buildQuery(bb) {
  return `[out:json][timeout:40];
(
  nwr["shop"]["name"](${bb});
  nwr["craft"]["name"](${bb});
  nwr["office"]["name"](${bb});
  nwr["amenity"~"^(restaurant|cafe|bar|fast_food|pub|bakery|ice_cream|pharmacy|bank|fuel|car_wash|car_rental|car_repair|driving_school|dentist|doctors|clinic|veterinary|marketplace|cinema|nightclub|childcare|kindergarten|boat_rental|boat_sharing)$"]["name"](${bb});
  nwr["tourism"~"^(hotel|motel|guest_house|hostel)$"]["name"](${bb});
  nwr["leisure"~"^(fitness_centre|sports_centre|marina|slipway)$"]["name"](${bb});
  nwr["industrial"]["name"](${bb});
);
out center ${MAX_RESULTS * 6};`;
}

// One attempt per endpoint, in order, until the wall-clock budget runs out.
async function queryOverpass(ql, deadline) {
  let lastErr = null;
  for (const url of OVERPASS_ENDPOINTS) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      lastErr = lastErr || new Error('ran out of time before a map server answered');
      break;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(remaining - 500, MAX_ATTEMPT_MS));
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'JZacLeadGenerator/1.1 (contact: JZacDesigns)'
        },
        body: 'data=' + encodeURIComponent(ql),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!r.ok) { lastErr = new Error(`map server responded ${r.status}`); continue; }

      // Overpass returns plain text (not JSON) when rate-limiting or erroring.
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); }
      catch { lastErr = new Error(`map server returned junk: ${text.slice(0, 100)}`); continue; }

      // Overpass signals its own server-side timeout via `remark` while still
      // returning HTTP 200 with an empty set.
      if (!(data.elements || []).length && data.remark) {
        lastErr = new Error(`map server: ${data.remark}`); continue;
      }
      return data.elements || [];
    } catch (err) {
      clearTimeout(timer);
      lastErr = err && err.name === 'AbortError' ? new Error(`${url.split('/')[2]} timed out`) : err;
    }
  }
  throw lastErr || new Error('every map server failed');
}

// Convert raw Overpass elements into ranked lead objects within the true radius.
export function toBusinesses(elements, lat, lng, radius) {
  const seen = new Map();
  for (const el of elements || []) {
    const t = el.tags || {};
    if (!t.name) continue;
    const bLat = el.lat ?? el.center?.lat;
    const bLng = el.lon ?? el.center?.lon;
    if (typeof bLat !== 'number' || typeof bLng !== 'number') continue;

    const dist = distanceMeters(lat, lng, bLat, bLng);
    if (dist > radius) continue; // the bbox is a square; keep the circle

    // The same business is often mapped twice - once as a node for the point
    // and once as a way for the building outline. Keying on name plus a coarse
    // 200 m cell collapses those into one lead instead of two identical rows.
    const key = `${t.name.toLowerCase().trim()}|${bLat.toFixed(3)},${bLng.toFixed(3)}`;
    const prev = seen.get(key);
    if (prev && prev._dist <= dist) continue;

    const tags = [t.shop, t.amenity, t.office, t.craft, t.tourism, t.leisure, t.industrial]
      .filter(Boolean);
    const { score, why } = scoreBusiness(t, tags);

    seen.set(key, {
      id: `${el.type}/${el.id}`,
      name: t.name,
      address: buildAddress(t),
      type: deriveType(t),
      types: tags,
      phone: t.phone || t['contact:phone'] || '',
      website: t.website || t['contact:website'] || '',
      lat: bLat,
      lng: bLng,
      state: normalizeState(t['addr:state']),
      distanceMiles: Math.round((dist / MILES_TO_METERS) * 10) / 10,
      score,
      why,
      _dist: dist
    });
  }

  // Best prospect first, nearest as the tie-break. Distance still matters - it
  // is just no longer the only thing that matters.
  return [...seen.values()].sort((a, b) => b.score - a.score || a._dist - b._dist);
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  const { lat, lng, radiusMiles = 5, force = false } = readBody(req);
  if (typeof lat !== 'number' || typeof lng !== 'number')
    return res.status(400).json({ error: 'lat and lng (numbers) are required' });

  const started = Date.now();
  const deadline = started + TOTAL_BUDGET_MS;
  const radius = Math.min(Math.max(Number(radiusMiles) || 5, 1) * MILES_TO_METERS, MAX_RADIUS_METERS);

  const steps = [...new Set([...LADDER_MILES.map((m) => m * MILES_TO_METERS), radius])]
    .filter((r) => r <= radius)
    .sort((a, b) => a - b);

  let best = [];
  let lastErr = null;
  let cached = false;

  for (const stepRadius of steps) {
    if (Date.now() > deadline - MIN_ATTEMPT_MS) break;
    const bb = boundingBox(lat, lng, stepRadius);
    const key = `ov1:${bb}`;
    try {
      let elements = force ? null : await getCachedElements(key);
      if (elements) {
        cached = true;
      } else {
        elements = await queryOverpass(buildQuery(bb), deadline);
        await putCachedElements(key, elements);
      }
      const found = toBusinesses(elements, lat, lng, radius);
      if (found.length > best.length) best = found;
      if (best.length >= MAX_RESULTS) break; // enough; stop widening
    } catch (err) {
      lastErr = err;
      if (best.length) break; // keep what a smaller step already found
    }
  }

  if (!best.length && lastErr) {
    return res.status(502).json({
      error:
        'The free map service is busy right now. Wait about thirty seconds and try again, ' +
        'or use a smaller radius — a 2 mile search almost always gets through when a 25 mile one will not.',
      detail: String(lastErr.message || lastErr)
    });
  }

  const businesses = best.slice(0, MAX_RESULTS).map(({ _dist, ...b }) => b);

  // Fire-and-forget: logging must never delay or break the rep's search.
  initDb()
    .then(() =>
      logActivity({
        user_id: auth.uid,
        type: 'search',
        lat,
        lng,
        detail: { radiusMiles, count: businesses.length, ms: Date.now() - started, cached }
      })
    )
    .catch(() => {});

  res.status(200).json({
    businesses,
    meta: {
      count: businesses.length,
      ms: Date.now() - started,
      cached,
      partial: Boolean(lastErr && businesses.length),
      note: lastErr && businesses.length ? 'Some of the area could not be searched — try again for the rest.' : ''
    }
  });
}
