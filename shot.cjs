/* Build, serve, stub the API, and LOOK at the thing on a phone screen.
 * A clean build proves nothing about whether it is usable one-handed. */
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = '/tmp/lh/dist';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };

const LEADS = [
  { id: 'n/1', name: 'Cascade Plumbing & Heating', address: '1204 164th St SE, Mill Creek, WA 98012',
    type: 'plumber', phone: '(425) 555-0100', website: 'https://example.com', lat: 47.86, lng: -122.20,
    distanceMiles: 0.3, score: 87, why: ['trade — likely running lettered vans'] },
  { id: 'n/2', name: 'Rolling Tacos Truck', address: 'Main St & 3rd Ave, Mill Creek, WA',
    type: 'fast food', phone: '(425) 555-0142', lat: 47.861, lng: -122.203,
    distanceMiles: 0.6, score: 85, why: ['mobile vendor — full vehicle wrap candidate'] },
  { id: 'w/3', name: 'Harbour Point Marina', address: '4213 Marine View Dr, Everett, WA 98203',
    type: 'marina', phone: '', lat: 47.98, lng: -122.22,
    distanceMiles: 4.1, score: 75, why: ['marine — registration numbers and boat names'] },
  { id: 'n/4', name: 'Corner Cafe', address: '815 Main St, Mill Creek, WA 98012',
    type: 'cafe', phone: '(425) 555-0177', lat: 47.859, lng: -122.201,
    distanceMiles: 0.2, score: 67, why: ['storefront — window and door graphics'] },
  { id: 'n/5', name: 'Smile Dental', address: '220 132nd St SE, Everett, WA',
    type: 'dentist', phone: '', lat: 47.88, lng: -122.21,
    distanceMiles: 1.9, score: 45, why: ['premises signage'] },
  { id: 'n/6', name: "McDonald's", address: '1500 132nd St SE, Everett, WA',
    type: 'fast food', phone: '(425) 555-0199', lat: 47.881, lng: -122.212,
    distanceMiles: 2.0, score: 25, why: ['chain — decisions made off-site'] }
];

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (url === '/api/auth/me') return res.end(JSON.stringify({ user: { id: 1, name: 'Zack', email: 'z@x.com', role: 'admin' } }));
    if (url === '/api/places/nearby')
      return res.end(JSON.stringify({ businesses: LEADS, meta: { count: LEADS.length, ms: 1420, cached: false, partial: false, note: '' } }));
    if (url === '/api/activity') return res.end(JSON.stringify({ ok: true }));
    return res.end(JSON.stringify({ items: [] }));
  }
  let f = path.join(DIST, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise((r) => server.listen(4599, r));
  const b = await chromium.launch();
  const ctx = await b.newContext({
    ...devices['iPhone 13'],
    permissions: ['geolocation'],
    geolocation: { latitude: 47.8601, longitude: -122.2043 }
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto('http://localhost:4599/', { waitUntil: 'load' });
  await p.evaluate(() => localStorage.setItem('jzac_token', 'stub'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(2500);

  // straight to the list, which is where the work actually happens
  const listBtn = p.locator('.tabbar button', { hasText: 'List' });
  if (await listBtn.count()) { await listBtn.click(); await p.waitForTimeout(800); }

  await p.screenshot({ path: '/tmp/lh/shot-list.png', fullPage: true });

  const audit = await p.evaluate(() => {
    const small = [...document.querySelectorAll('a,button')]
      .map((e) => ({ t: (e.innerText || '').trim().slice(0, 18), h: Math.round(e.getBoundingClientRect().height) }))
      .filter((x) => x.h > 0 && x.h < 44);
    return {
      leads: document.querySelectorAll('.lead').length,
      bands: [...document.querySelectorAll('.score')].map((e) => e.textContent),
      dists: [...document.querySelectorAll('.dist')].map((e) => e.textContent),
      whys: [...document.querySelectorAll('.why')].length,
      tooSmallTapTargets: small,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
  console.log(JSON.stringify({ audit, errs }, null, 1));

  await b.close();
  server.close();
})();
