/* Does the ranking actually put the right doors first, and does dedupe work?
 * Realistic OSM tag shapes, checked against what a vinyl shop would say if you
 * showed them the list. */
import { scoreBusiness, toBusinesses } from './api/places/nearby.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FAIL: ' + msg); } };

// Mill Creek WA, roughly
const LAT = 47.8601, LNG = -122.2043;
const near = (dLat = 0, dLng = 0) => ({ lat: LAT + dLat, lon: LNG + dLng });

const cases = [
  ['plumber (van fleet)',        { name: 'Acme Plumbing', craft: 'plumber', phone: '425-555-0100' }, ['plumber']],
  ['marina',                     { name: 'Harbour Marina', leisure: 'marina' }, ['marina']],
  ['truck repair',               { name: 'Big Rig Repair', shop: 'truck_repair' }, ['truck_repair']],
  ['independent cafe',           { name: 'Corner Cafe', amenity: 'cafe', phone: '425-555-0111' }, ['cafe']],
  ['dentist',                    { name: 'Smile Dental', amenity: 'dentist' }, ['dentist']],
  ['chain bank',                 { name: 'Chase', amenity: 'bank', brand: 'Chase', 'brand:wikidata': 'Q524629' }, ['bank']],
  ['chain fast food',            { name: "McDonald's", amenity: 'fast_food', brand: "McDonald's", 'brand:wikidata': 'Q38076' }, ['fast_food']],
  ['food truck',                 { name: 'Rolling Tacos Truck', amenity: 'fast_food' }, ['fast_food']]
];

console.log('--- scores ---');
const scored = cases.map(([label, tags, list]) => {
  const { score, why } = scoreBusiness(tags, list);
  console.log(`  ${String(score).padStart(3)}  ${label.padEnd(24)} ${why[0] || ''}`);
  return { label, score };
});
const by = (n) => scored.find((s) => s.label === n).score;

console.log('\n--- assertions ---');
ok(by('plumber (van fleet)') > by('independent cafe'), 'a plumber should outrank a cafe');
ok(by('marina') > by('dentist'), 'a marina should outrank a dentist');
ok(by('truck repair') > by('dentist'), 'truck repair should outrank a dentist');
ok(by('chain bank') < by('independent cafe'), 'a chain bank should rank below an independent cafe');
ok(by('chain fast food') < by('food truck'), 'a corporate chain should rank below an independent food truck');
ok(by('food truck') > by('independent cafe'), 'a food truck (rolling billboard) should outrank a fixed cafe');
ok(by('chain bank') < 40, 'a chain bank should land in the low band');
ok(by('plumber (van fleet)') >= 75, 'a phoneable trade should land in the HOT band');

// ---- dedupe: the same business mapped as a node AND a building outline ------
const dupes = [
  { type: 'node', id: 1, lat: LAT, lon: LNG, tags: { name: 'Acme Plumbing', craft: 'plumber' } },
  { type: 'way', id: 2, center: near(0.00002, 0.00002), tags: { name: 'acme plumbing  ', craft: 'plumber' } },
  { type: 'node', id: 3, ...near(0.004, 0.004), tags: { name: 'Corner Cafe', amenity: 'cafe' } }
];
const out = toBusinesses(dupes, LAT, LNG, 8000);
console.log('\n--- dedupe ---');
console.log('  in: 3 elements (two are the same plumber) -> out:', out.length);
ok(out.length === 2, 'the duplicated plumber should collapse to one lead');
ok(out[0].name.toLowerCase().includes('acme'), 'the plumber should be ranked first, not the nearer cafe');
ok(out[0].distanceMiles === 0, 'distance should be present and zero at our own position');

// ---- the radius is a circle, not the query's square ------------------------
const farCorner = [{ type: 'node', id: 9, lat: LAT + 0.05, lon: LNG + 0.05, tags: { name: 'Far Co', craft: 'plumber' } }];
ok(toBusinesses(farCorner, LAT, LNG, 1000).length === 0, 'a business outside the radius must be dropped');

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL LEAD-RANKING CHECKS PASSED');
process.exit(fails ? 1 : 0);
